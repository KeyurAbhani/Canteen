import * as SQLite from "expo-sqlite";

type SyncDatabase = ReturnType<typeof SQLite.openDatabaseSync>;
type OutboxEvent = {
  local_id: number;
  event_id: string;
  entity: string;
  operation: "upsert" | "delete";
  payload: string;
  created_at: string;
};
type CloudEvent = {
  id: number;
  event_id: string;
  client_id: string;
  entity: string;
  operation: "upsert" | "delete";
  payload: Record<string, unknown>;
};

const sharedSettings = [
  "bhojanshala_price_breakfast",
  "bhojanshala_price_lunch",
  "bhojanshala_price_dinner",
  "bhojanshala_parcel_price",
  "receipt_serial_start",
];

function entityTables() {
  return [
    ["menu_items", "menu_items"],
    ["orders", "orders"],
    ["order_items", "order_items"],
    ["bhojanshala_slips", "bhojanshala_slips"],
    ["inventory_purchases", "inventory_purchases"],
  ] as const;
}

function createTrigger(db: SyncDatabase, sql: string) {
  db.execSync(sql);
}

export function initializeCloudSync(db: SyncDatabase) {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS cloud_sync_outbox (
      local_id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      entity TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cloud_sync_control (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      suppress INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO cloud_sync_control (id, suppress) VALUES (1, 0);
    INSERT OR IGNORE INTO app_settings (setting_key, setting_value)
      VALUES ('cloud_sync_client_id', lower(hex(randomblob(16))));
    INSERT OR IGNORE INTO app_settings (setting_key, setting_value)
      VALUES ('cloud_sync_cursor', '0');
  `);

  for (const [table] of entityTables()) {
    const columns = db.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`);
    if (!columns.some((column) => column.name === "sync_id")) {
      db.execSync(`ALTER TABLE ${table} ADD COLUMN sync_id TEXT`);
    }
    db.runSync(`UPDATE ${table} SET sync_id = lower(hex(randomblob(16))) WHERE sync_id IS NULL OR sync_id = ''`);
    db.execSync(`CREATE UNIQUE INDEX IF NOT EXISTS ux_${table}_sync_id ON ${table}(sync_id)`);
  }

  for (const [table] of entityTables()) {
    for (const action of ["insert", "update", "delete"] as const) {
      db.execSync(`DROP TRIGGER IF EXISTS cloud_sync_${table}_${action}`);
    }
  }
  for (const action of ["insert", "update", "delete"] as const) {
    db.execSync(`DROP TRIGGER IF EXISTS cloud_sync_app_settings_${action}`);
    db.execSync(`DROP TRIGGER IF EXISTS cloud_sync_daily_tokens_${action}`);
  }

  const commonBefore = `
    WHEN (SELECT suppress FROM cloud_sync_control WHERE id = 1) = 0
  `;
  const makeEvent = (entity: string, op: string, payload: string) => `
    INSERT INTO cloud_sync_outbox (event_id, entity, operation, payload, created_at)
    SELECT setting_value || ':' || lower(hex(randomblob(16))), '${entity}', '${op}', ${payload},
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM app_settings WHERE setting_key = 'cloud_sync_client_id';
  `;

  for (const [table, entity] of entityTables()) {
    const fields: Record<string, string> = {
      menu_items: "'sync_id', sync_id, 'name', name, 'price', price, 'active', active, 'meal_type', meal_type",
      orders: "'sync_id', sync_id, 'token', token, 'order_date', order_date, 'total', total, 'created_at', created_at",
      order_items: "'sync_id', sync_id, 'order_sync_id', (SELECT sync_id FROM orders WHERE id = order_id), 'token', token, 'item_name', item_name, 'unit_price', unit_price, 'quantity', quantity",
      bhojanshala_slips: "'sync_id', sync_id, 'meal', meal, 'category', category, 'price', price, 'parcel_price', parcel_price, 'quantity', quantity, 'payment_mode', payment_mode, 'order_date', order_date, 'created_at', created_at",
      inventory_purchases: "'sync_id', sync_id, 'item_name', item_name, 'quantity', quantity, 'unit', unit, 'total_cost', total_cost, 'purchase_date', purchase_date, 'created_at', created_at, 'department', department",
    };
    createTrigger(db, `CREATE TRIGGER cloud_sync_${table}_insert AFTER INSERT ON ${table}
      ${commonBefore}
      BEGIN
        UPDATE ${table} SET sync_id = COALESCE(sync_id, lower(hex(randomblob(16)))) WHERE id = NEW.id;
        ${makeEvent(entity, "upsert", `(
          SELECT json_object(${fields[table]}) FROM ${table} WHERE id = NEW.id
        )`)}
      END;`);
    createTrigger(db, `CREATE TRIGGER cloud_sync_${table}_update AFTER UPDATE ON ${table}
      WHEN (SELECT suppress FROM cloud_sync_control WHERE id = 1) = 0 AND NEW.sync_id IS OLD.sync_id
      BEGIN
        ${makeEvent(entity, "upsert", `(
          SELECT json_object(${fields[table]}) FROM ${table} WHERE id = NEW.id
        )`)}
      END;`);
    const deletePayload = table === "order_items"
      ? "json_object('sync_id', OLD.sync_id, 'order_sync_id', (SELECT sync_id FROM orders WHERE id = OLD.order_id))"
      : "json_object('sync_id', OLD.sync_id)";
    createTrigger(db, `CREATE TRIGGER cloud_sync_${table}_delete AFTER DELETE ON ${table}
      ${commonBefore}
      BEGIN
        ${makeEvent(entity, "delete", deletePayload)}
      END;`);
  }

  const keyList = sharedSettings.map((key) => `'${key}'`).join(", ");
  createTrigger(db, `CREATE TRIGGER cloud_sync_app_settings_insert AFTER INSERT ON app_settings
    WHEN NEW.setting_key IN (${keyList}) AND (SELECT suppress FROM cloud_sync_control WHERE id = 1) = 0
    BEGIN
      ${makeEvent("app_settings", "upsert", "json_object('setting_key', NEW.setting_key, 'setting_value', NEW.setting_value)")}
    END;`);
  createTrigger(db, `CREATE TRIGGER cloud_sync_app_settings_update AFTER UPDATE ON app_settings
    WHEN NEW.setting_key IN (${keyList}) AND (SELECT suppress FROM cloud_sync_control WHERE id = 1) = 0
    BEGIN
      ${makeEvent("app_settings", "upsert", "json_object('setting_key', NEW.setting_key, 'setting_value', NEW.setting_value)")}
    END;`);
  createTrigger(db, `CREATE TRIGGER cloud_sync_app_settings_delete AFTER DELETE ON app_settings
    WHEN OLD.setting_key IN (${keyList}) AND (SELECT suppress FROM cloud_sync_control WHERE id = 1) = 0
    BEGIN
      ${makeEvent("app_settings", "delete", "json_object('setting_key', OLD.setting_key)")}
    END;`);

  createTrigger(db, `CREATE TRIGGER cloud_sync_daily_tokens_insert AFTER INSERT ON daily_token_sequences
    ${commonBefore}
    BEGIN
      ${makeEvent("daily_token_sequences", "upsert", "json_object('order_date', NEW.order_date, 'last_token', NEW.last_token)")}
    END;`);
  createTrigger(db, `CREATE TRIGGER cloud_sync_daily_tokens_update AFTER UPDATE ON daily_token_sequences
    ${commonBefore}
    BEGIN
      ${makeEvent("daily_token_sequences", "upsert", "json_object('order_date', NEW.order_date, 'last_token', NEW.last_token)")}
    END;`);
  createTrigger(db, `CREATE TRIGGER cloud_sync_daily_tokens_delete AFTER DELETE ON daily_token_sequences
    ${commonBefore}
    BEGIN
      ${makeEvent("daily_token_sequences", "delete", "json_object('order_date', OLD.order_date)")}
    END;`);

  const seeded = db.getFirstSync<{ setting_value: string }>(
    "SELECT setting_value FROM app_settings WHERE setting_key = 'cloud_sync_initial_snapshot_v1'",
  )?.setting_value;
  if (seeded) return;
  db.withTransactionSync(() => {
    for (const [table, entity] of entityTables()) {
      const fields: Record<string, string> = {
        menu_items: "'sync_id', sync_id, 'name', name, 'price', price, 'active', active, 'meal_type', meal_type",
        orders: "'sync_id', sync_id, 'token', token, 'order_date', order_date, 'total', total, 'created_at', created_at",
        order_items: "'sync_id', sync_id, 'order_sync_id', (SELECT sync_id FROM orders WHERE id = order_id), 'token', token, 'item_name', item_name, 'unit_price', unit_price, 'quantity', quantity",
        bhojanshala_slips: "'sync_id', sync_id, 'meal', meal, 'category', category, 'price', price, 'parcel_price', parcel_price, 'quantity', quantity, 'payment_mode', payment_mode, 'order_date', order_date, 'created_at', created_at",
        inventory_purchases: "'sync_id', sync_id, 'item_name', item_name, 'quantity', quantity, 'unit', unit, 'total_cost', total_cost, 'purchase_date', purchase_date, 'created_at', created_at, 'department', department",
      };
      const rowIds = db.getAllSync<{ id: number }>(`SELECT id FROM ${table}`);
      for (const row of rowIds) {
        db.runSync(
          `INSERT INTO cloud_sync_outbox (event_id, entity, operation, payload, created_at)
           SELECT setting_value || ':' || lower(hex(randomblob(16))), ?, 'upsert',
             (SELECT json_object(${fields[table]}) FROM ${table} WHERE id = ?),
             strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           FROM app_settings WHERE setting_key = 'cloud_sync_client_id'`,
          entity,
          row.id,
        );
      }
    }
    for (const key of sharedSettings) {
      db.runSync(
        `INSERT INTO cloud_sync_outbox (event_id, entity, operation, payload, created_at)
         SELECT setting_value || ':' || lower(hex(randomblob(16))), 'app_settings', 'upsert',
           json_object('setting_key', setting_key, 'setting_value', setting_value),
           strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         FROM app_settings WHERE setting_key = ? AND EXISTS (
           SELECT 1 FROM app_settings WHERE setting_key = 'cloud_sync_client_id'
         )`,
        key,
      );
    }
    const sequences = db.getAllSync<{ order_date: string; last_token: number }>(
      "SELECT order_date, last_token FROM daily_token_sequences",
    );
    for (const sequence of sequences) {
      db.runSync(
        `INSERT INTO cloud_sync_outbox (event_id, entity, operation, payload, created_at)
         SELECT setting_value || ':' || lower(hex(randomblob(16))), 'daily_token_sequences', 'upsert',
           json_object('order_date', ?, 'last_token', ?), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         FROM app_settings WHERE setting_key = 'cloud_sync_client_id'`,
        sequence.order_date,
        sequence.last_token,
      );
    }
    db.runSync(
      "INSERT INTO app_settings (setting_key, setting_value) VALUES ('cloud_sync_initial_snapshot_v1', '1')",
    );
  });
}

export async function reserveCloudToken(
  apiUrl: string,
  syncToken: string,
  clientId: string,
  orderSyncId: string,
  orderDate: string,
  firstToken: number,
) {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${syncToken}`,
    },
    body: JSON.stringify({
      action: "reserve_token",
      client_id: clientId,
      order_sync_id: orderSyncId,
      order_date: orderDate,
      first_token: firstToken,
    }),
  });
  const body = await response.json() as { error?: string; token?: number };
  if (!response.ok || !Number.isSafeInteger(body.token) || (body.token ?? 0) < 1) {
    throw new Error(body.error ?? `Cloud server returned ${response.status} while reserving a receipt number.`);
  }
  return body.token!;
}

function upsertMenuItem(db: SyncDatabase, payload: Record<string, unknown>) {
  const syncId = String(payload.sync_id ?? "");
  const name = String(payload.name ?? "");
  let local = db.getFirstSync<{ id: number; sync_id: string }>(
    "SELECT id, sync_id FROM menu_items WHERE sync_id = ?",
    syncId,
  );
  if (!local && name) {
    local = db.getFirstSync<{ id: number; sync_id: string }>(
      "SELECT id, sync_id FROM menu_items WHERE lower(trim(name)) = lower(trim(?)) LIMIT 1",
      name,
    );
    if (local) {
      const pending = db.getAllSync<{ local_id: number; payload: string }>(
        "SELECT local_id, payload FROM cloud_sync_outbox WHERE entity = 'menu_items'",
      );
      for (const event of pending) {
        try {
          if (String(JSON.parse(event.payload).name ?? "").trim().toLowerCase() === name.trim().toLowerCase())
            db.runSync("DELETE FROM cloud_sync_outbox WHERE local_id = ?", event.local_id);
        } catch { /* Ignore malformed old outbox data; server validation will report it. */ }
      }
    }
  }
  if (local) {
    db.runSync(
      "UPDATE menu_items SET sync_id = ?, name = ?, price = ?, active = ?, meal_type = ? WHERE id = ?",
      syncId,
      name,
      Number(payload.price ?? 0),
      Number(payload.active ?? 1),
      String(payload.meal_type ?? "lunch"),
      local.id,
    );
  } else {
    db.runSync(
      "INSERT INTO menu_items (sync_id, name, price, active, meal_type) VALUES (?, ?, ?, ?, ?)",
      syncId,
      name,
      Number(payload.price ?? 0),
      Number(payload.active ?? 1),
      String(payload.meal_type ?? "lunch"),
    );
  }
}

function applyCloudEvent(db: SyncDatabase, event: CloudEvent) {
  const payload = event.payload;
  const syncId = String(payload.sync_id ?? "");
  const isDelete = event.operation === "delete";
  switch (event.entity) {
    case "menu_items": {
      if (isDelete) db.runSync("DELETE FROM menu_items WHERE sync_id = ?", syncId);
      else upsertMenuItem(db, payload);
      break;
    }
    case "orders": {
      if (isDelete) {
        const order = db.getFirstSync<{ id: number }>("SELECT id FROM orders WHERE sync_id = ?", syncId);
        if (order) {
          db.runSync("DELETE FROM order_items WHERE order_id = ?", order.id);
          db.runSync("DELETE FROM orders WHERE id = ?", order.id);
        }
      } else {
        const existing = db.getFirstSync<{ id: number }>("SELECT id FROM orders WHERE sync_id = ?", syncId);
        const values = [Number(payload.token), String(payload.order_date), Number(payload.total), String(payload.created_at)];
        if (existing)
          db.runSync("UPDATE orders SET token = ?, order_date = ?, total = ?, created_at = ? WHERE id = ?", ...values, existing.id);
        else
          db.runSync("INSERT INTO orders (sync_id, token, order_date, total, created_at) VALUES (?, ?, ?, ?, ?)", syncId, ...values);
      }
      break;
    }
    case "order_items": {
      const orderSyncId = String(payload.order_sync_id ?? "");
      const existing = db.getFirstSync<{ id: number }>("SELECT id FROM order_items WHERE sync_id = ?", syncId);
      if (isDelete) {
        if (existing) db.runSync("DELETE FROM order_items WHERE id = ?", existing.id);
      } else {
        const order = db.getFirstSync<{ id: number }>("SELECT id FROM orders WHERE sync_id = ?", orderSyncId);
        if (!order) throw new Error("A synced order line arrived before its order. Retry sync.");
        const values = [order.id, Number(payload.token), String(payload.item_name), Number(payload.unit_price), Number(payload.quantity)];
        if (existing)
          db.runSync("UPDATE order_items SET order_id = ?, token = ?, item_name = ?, unit_price = ?, quantity = ? WHERE id = ?", ...values, existing.id);
        else
          db.runSync("INSERT INTO order_items (sync_id, order_id, token, item_name, unit_price, quantity) VALUES (?, ?, ?, ?, ?, ?)", syncId, ...values);
      }
      break;
    }
    case "bhojanshala_slips": {
      const existing = db.getFirstSync<{ id: number }>("SELECT id FROM bhojanshala_slips WHERE sync_id = ?", syncId);
      if (isDelete) {
        if (existing) db.runSync("DELETE FROM bhojanshala_slips WHERE id = ?", existing.id);
      } else {
        const values = [String(payload.meal), String(payload.category), Number(payload.price), Number(payload.quantity), String(payload.payment_mode), String(payload.order_date), String(payload.created_at), Number(payload.parcel_price ?? 0)];
        if (existing)
          db.runSync("UPDATE bhojanshala_slips SET meal = ?, category = ?, price = ?, quantity = ?, payment_mode = ?, order_date = ?, created_at = ?, parcel_price = ? WHERE id = ?", ...values, existing.id);
        else
          db.runSync("INSERT INTO bhojanshala_slips (sync_id, meal, category, price, quantity, payment_mode, order_date, created_at, parcel_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", syncId, ...values);
      }
      break;
    }
    case "inventory_purchases": {
      const existing = db.getFirstSync<{ id: number }>("SELECT id FROM inventory_purchases WHERE sync_id = ?", syncId);
      if (isDelete) {
        if (existing) db.runSync("DELETE FROM inventory_purchases WHERE id = ?", existing.id);
      } else {
        const values = [String(payload.item_name), Number(payload.quantity), String(payload.unit), Number(payload.total_cost), String(payload.purchase_date), String(payload.created_at), String(payload.department ?? "Canteen")];
        if (existing)
          db.runSync("UPDATE inventory_purchases SET item_name = ?, quantity = ?, unit = ?, total_cost = ?, purchase_date = ?, created_at = ?, department = ? WHERE id = ?", ...values, existing.id);
        else
          db.runSync("INSERT INTO inventory_purchases (sync_id, item_name, quantity, unit, total_cost, purchase_date, created_at, department) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", syncId, ...values);
      }
      break;
    }
    case "app_settings": {
      const key = String(payload.setting_key ?? "");
      if (!sharedSettings.includes(key)) break;
      if (isDelete) db.runSync("DELETE FROM app_settings WHERE setting_key = ?", key);
      else db.runSync("INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value", key, String(payload.setting_value ?? ""));
      break;
    }
    case "daily_token_sequences": {
      const date = String(payload.order_date ?? "");
      if (isDelete) db.runSync("DELETE FROM daily_token_sequences WHERE order_date = ?", date);
      else db.runSync("INSERT INTO daily_token_sequences (order_date, last_token) VALUES (?, ?) ON CONFLICT(order_date) DO UPDATE SET last_token = MAX(last_token, excluded.last_token)", date, Number(payload.last_token ?? 0));
      break;
    }
  }
}

export async function synchronizeCloudDatabase(
  db: SyncDatabase,
  apiUrl: string,
  syncToken: string,
  clientId: string,
  onProgress?: (message: string) => void,
) {
  if (!apiUrl.startsWith("https://")) throw new Error("Use the HTTPS URL of the Hostinger sync.php endpoint.");
  let cursor = Number(db.getFirstSync<{ setting_value: string }>(
    "SELECT setting_value FROM app_settings WHERE setting_key = 'cloud_sync_cursor'",
  )?.setting_value ?? "0");
  let uploaded = 0;
  let downloaded = 0;

  async function requestPage(events: OutboxEvent[]) {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${syncToken}`,
      },
      body: JSON.stringify({
        client_id: clientId,
        cursor,
        events: events.map(({ event_id, entity, operation, payload, created_at }) => ({ event_id, entity, operation, payload, created_at })),
      }),
    });
    const body = await response.json() as { error?: string; events?: CloudEvent[]; next_cursor?: number };
    if (!response.ok) throw new Error(body.error ?? `Cloud server returned ${response.status}.`);
    if (!Array.isArray(body.events) || typeof body.next_cursor !== "number")
      throw new Error("The cloud server returned an invalid sync response.");
    return body;
  }

  function applyPage(events: CloudEvent[], nextCursor: number, outgoing: OutboxEvent[]) {
    db.withTransactionSync(() => {
      db.runSync("UPDATE cloud_sync_control SET suppress = 1 WHERE id = 1");
      try {
        for (const event of events) applyCloudEvent(db, event);
        cursor = nextCursor;
        db.runSync("INSERT INTO app_settings (setting_key, setting_value) VALUES ('cloud_sync_cursor', ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value", String(cursor));
        for (const event of outgoing) db.runSync("DELETE FROM cloud_sync_outbox WHERE local_id = ?", event.local_id);
      } finally {
        db.runSync("UPDATE cloud_sync_control SET suppress = 0 WHERE id = 1");
      }
    });
  }

  // Pull first. This lets a newly installed phone receive the existing shared
  // menu before its local default menu values are uploaded.
  for (let page = 0; page < 1000; page++) {
    onProgress?.("Downloading cloud changes…");
    const body = await requestPage([]);
    applyPage(body.events!, body.next_cursor!, []);
    downloaded += body.events!.length;
    if (body.events!.length < 200) break;
    if (page === 999) throw new Error("There are many cloud changes. Tap Sync now again to continue.");
  }

  for (let page = 0; page < 1000; page++) {
    const outgoing = db.getAllSync<OutboxEvent>(
      "SELECT local_id, event_id, entity, operation, payload, created_at FROM cloud_sync_outbox ORDER BY local_id LIMIT 200",
    );
    onProgress?.(outgoing.length ? `Uploading ${outgoing.length} changes…` : "Checking for updates…");
    const body = await requestPage(outgoing);
    applyPage(body.events!, body.next_cursor!, outgoing);
    uploaded += outgoing.length;
    downloaded += body.events!.length;
    const pending = db.getFirstSync<{ count: number }>("SELECT COUNT(*) AS count FROM cloud_sync_outbox")?.count ?? 0;
    if (!pending && body.events!.length < 200) {
      return { uploaded, downloaded };
    }
  }
  throw new Error("Sync is still catching up. Tap Sync now again to continue.");
}
