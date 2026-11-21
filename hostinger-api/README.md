# Hostinger cloud sync setup

The mobile app must connect to an HTTPS API. It must never connect directly to
MySQL or contain MySQL credentials because credentials inside an APK can be
extracted.

## Install the API

1. In Hostinger phpMyAdmin, import `schema.sql` into the MySQL/MariaDB database.
2. Copy the contents of `public/` to `public_html/canteen-sync/`.
3. Copy `config.example.php` to `canteen-sync-config.php` in the domain root,
   alongside `public_html` (outside the publicly served directory).
4. In `canteen-sync-config.php`, enter the database host, name, username, and
   password from hPanel. Replace `sync_token` with a long random secret.
5. Use HTTPS and set the app URL to
   `https://YOUR-DOMAIN/canteen-sync/sync.php`. Enter the same sync token on
   each authorized phone in the app's Cloud Sync screen.

The real config file is ignored by Git. Do not commit it or put MySQL
credentials in the app. The API stores incoming changes as idempotent events;
the app can safely retry after a connection failure.

This API creates only the app-specific `canteen_sync_events` table and does not
change other databases/tables already on the account.
