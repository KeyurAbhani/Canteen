<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function respond(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function ensureTokenSequence(PDO $pdo, string $date, int $minimum): int
{
    $insert = $pdo->prepare('INSERT IGNORE INTO canteen_token_sequences (order_date, last_token) VALUES (?, 0)');
    $insert->execute([$date]);
    $select = $pdo->prepare('SELECT last_token FROM canteen_token_sequences WHERE order_date = ? FOR UPDATE');
    $select->execute([$date]);
    $last = (int)$select->fetchColumn();
    $next = max($minimum, $last + 1);
    $update = $pdo->prepare('UPDATE canteen_token_sequences SET last_token = ? WHERE order_date = ?');
    $update->execute([$next, $date]);
    return $next;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    respond(405, ['error' => 'Use POST']);
}

$configPath = dirname(__DIR__, 2) . '/canteen-sync-config.php';
if (!is_file($configPath)) respond(503, ['error' => 'Hostinger sync configuration is missing']);
$config = require $configPath;
$expectedToken = (string)($config['sync_token'] ?? '');
$headers = function_exists('getallheaders') ? getallheaders() : [];
$authorization = (string)(
    $_SERVER['HTTP_AUTHORIZATION']
    ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
    ?? $headers['Authorization']
    ?? $headers['authorization']
    ?? ''
);
$providedToken = str_starts_with($authorization, 'Bearer ') ? substr($authorization, 7) : '';
if ($expectedToken === '' || !hash_equals($expectedToken, $providedToken)) {
    respond(401, ['error' => 'Invalid sync key']);
}

$input = json_decode(file_get_contents('php://input') ?: '', true);
if (!is_array($input)) respond(400, ['error' => 'Invalid JSON body']);
$clientId = (string)($input['client_id'] ?? '');
$action = (string)($input['action'] ?? 'sync');
if (!preg_match('/^[a-f0-9-]{16,64}$/i', $clientId)) respond(400, ['error' => 'Invalid client ID']);

$database = $config['database'] ?? [];
foreach (['host', 'name', 'username', 'password'] as $key) {
    if (!isset($database[$key]) || $database[$key] === '') {
        respond(503, ['error' => 'Database configuration is incomplete']);
    }
}

try {
    $charset = preg_replace('/[^a-zA-Z0-9_]/', '', (string)($database['charset'] ?? 'utf8mb4'));
    $pdo = new PDO(
        "mysql:host={$database['host']};dbname={$database['name']};charset={$charset}",
        (string)$database['username'],
        (string)$database['password'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false],
    );

    if ($action === 'reserve_token') {
        $date = (string)($input['order_date'] ?? '');
        $orderSyncId = (string)($input['order_sync_id'] ?? '');
        $firstToken = filter_var($input['first_token'] ?? 1, FILTER_VALIDATE_INT);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)
            || !preg_match('/^[a-f0-9]{32}$/i', $orderSyncId)
            || $firstToken === false || $firstToken < 1) {
            respond(400, ['error' => 'Invalid token request']);
        }
        $pdo->beginTransaction();
        $existing = $pdo->prepare('SELECT token FROM canteen_order_tokens WHERE sync_id = ? FOR UPDATE');
        $existing->execute([$orderSyncId]);
        $token = $existing->fetchColumn();
        if ($token === false) {
            $token = ensureTokenSequence($pdo, $date, $firstToken);
            $reserve = $pdo->prepare('INSERT INTO canteen_order_tokens (sync_id, order_date, token) VALUES (?, ?, ?)');
            $reserve->execute([$orderSyncId, $date, $token]);
        }
        $pdo->commit();
        respond(200, ['token' => (int)$token]);
    }
    if ($action !== 'sync') respond(400, ['error' => 'Unknown action']);

    $cursor = filter_var($input['cursor'] ?? 0, FILTER_VALIDATE_INT);
    $events = $input['events'] ?? [];
    if ($cursor === false || $cursor < 0 || !is_array($events) || count($events) > 200) {
        respond(400, ['error' => 'Invalid sync request']);
    }

    $pdo->beginTransaction();
    $findEvent = $pdo->prepare('SELECT id FROM canteen_sync_events WHERE event_id = ?');
    $insertEvent = $pdo->prepare(
        'INSERT IGNORE INTO canteen_sync_events (event_id, client_id, entity, operation, payload) VALUES (?, ?, ?, ?, ?)'
    );
    foreach ($events as $event) {
        if (!is_array($event)) throw new InvalidArgumentException('Invalid event');
        $eventId = (string)($event['event_id'] ?? '');
        $entity = (string)($event['entity'] ?? '');
        $operation = (string)($event['operation'] ?? '');
        $payloadText = (string)($event['payload'] ?? '');
        $payload = json_decode($payloadText, true);
        if (!preg_match('/^[a-f0-9-]{16,64}:[a-f0-9]{32}$/i', $eventId)
            || !str_starts_with($eventId, $clientId . ':')
            || !in_array($entity, ['menu_items', 'orders', 'order_items', 'bhojanshala_slips', 'inventory_purchases', 'app_settings', 'daily_token_sequences'], true)
            || !in_array($operation, ['upsert', 'delete'], true)
            || strlen($payloadText) > 65535
            || !is_array($payload)) {
            throw new InvalidArgumentException('Invalid event');
        }
        $findEvent->execute([$eventId]);
        if ($findEvent->fetchColumn()) continue;

        if ($entity === 'orders' && $operation === 'upsert') {
            $syncId = (string)($payload['sync_id'] ?? '');
            $date = (string)($payload['order_date'] ?? '');
            $proposed = filter_var($payload['token'] ?? 0, FILTER_VALIDATE_INT);
            if (!preg_match('/^[a-f0-9]{32}$/i', $syncId) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || $proposed === false || $proposed < 1) {
                throw new InvalidArgumentException('Invalid order event');
            }
            $findToken = $pdo->prepare('SELECT token FROM canteen_order_tokens WHERE sync_id = ? FOR UPDATE');
            $findToken->execute([$syncId]);
            $canonical = $findToken->fetchColumn();
            if ($canonical === false) {
                $sequenceInsert = $pdo->prepare('INSERT IGNORE INTO canteen_token_sequences (order_date, last_token) VALUES (?, 0)');
                $sequenceInsert->execute([$date]);
                $sequenceQuery = $pdo->prepare('SELECT last_token FROM canteen_token_sequences WHERE order_date = ? FOR UPDATE');
                $sequenceQuery->execute([$date]);
                $last = (int)$sequenceQuery->fetchColumn();
                $findCollision = $pdo->prepare('SELECT sync_id FROM canteen_order_tokens WHERE order_date = ? AND token = ?');
                $findCollision->execute([$date, $proposed]);
                $collision = $findCollision->fetchColumn();
                $canonical = $collision === false ? $proposed : max($proposed, $last + 1);
                $assign = $pdo->prepare('INSERT INTO canteen_order_tokens (sync_id, order_date, token) VALUES (?, ?, ?)');
                $assign->execute([$syncId, $date, $canonical]);
                $sequenceUpdate = $pdo->prepare('UPDATE canteen_token_sequences SET last_token = GREATEST(last_token, ?) WHERE order_date = ?');
                $sequenceUpdate->execute([$canonical, $date]);
            }
            $payload['token'] = (int)$canonical;
            $payloadText = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        } elseif ($entity === 'order_items' && $operation === 'upsert') {
            $orderSyncId = (string)($payload['order_sync_id'] ?? '');
            $findToken = $pdo->prepare('SELECT token FROM canteen_order_tokens WHERE sync_id = ?');
            $findToken->execute([$orderSyncId]);
            $canonical = $findToken->fetchColumn();
            if ($canonical !== false) {
                $payload['token'] = (int)$canonical;
                $payloadText = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            }
        } elseif ($entity === 'daily_token_sequences' && $operation === 'upsert') {
            $date = (string)($payload['order_date'] ?? '');
            $last = filter_var($payload['last_token'] ?? 0, FILTER_VALIDATE_INT);
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || $last === false || $last < 0) {
                throw new InvalidArgumentException('Invalid token sequence event');
            }
            $sequence = $pdo->prepare('INSERT INTO canteen_token_sequences (order_date, last_token) VALUES (?, ?) ON DUPLICATE KEY UPDATE last_token = GREATEST(last_token, VALUES(last_token))');
            $sequence->execute([$date, $last]);
        }
        $insertEvent->execute([$eventId, $clientId, $entity, $operation, $payloadText]);
    }
    $pdo->commit();

    $select = $pdo->prepare(
        'SELECT id, event_id, client_id, entity, operation, payload FROM canteen_sync_events WHERE id > ? ORDER BY id ASC LIMIT 200'
    );
    $select->execute([$cursor]);
    $rows = $select->fetchAll(PDO::FETCH_ASSOC);
    $resultEvents = [];
    $nextCursor = $cursor;
    foreach ($rows as $row) {
        $row['id'] = (int)$row['id'];
        $row['payload'] = json_decode($row['payload'], true);
        $nextCursor = $row['id'];
        $resultEvents[] = $row;
    }
    respond(200, ['events' => $resultEvents, 'next_cursor' => $nextCursor]);
} catch (InvalidArgumentException $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    respond(400, ['error' => $error->getMessage()]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    error_log('Canteen cloud sync failed: ' . $error->getMessage());
    respond(500, ['error' => 'Cloud sync failed; check the Hostinger server log']);
}
