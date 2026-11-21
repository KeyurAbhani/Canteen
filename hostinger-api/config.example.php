<?php
declare(strict_types=1);

// Copy this to canteen-sync-config.php on Hostinger and fill in the values
// from hPanel. Keep the real file outside public_html and out of Git.
return [
    'database' => [
        'host' => 'localhost', // Use the database host shown in Hostinger hPanel.
        'name' => '',
        'username' => '',
        'password' => '',
        'charset' => 'utf8mb4',
    ],
    // Make a long random value and enter the same value in Cloud Sync on each phone.
    'sync_token' => 'replace-with-a-long-random-secret',
];
