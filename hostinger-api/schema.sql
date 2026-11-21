CREATE TABLE IF NOT EXISTS canteen_sync_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(160) NOT NULL,
  client_id VARCHAR(64) NOT NULL,
  entity VARCHAR(40) NOT NULL,
  operation VARCHAR(12) NOT NULL,
  payload LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_canteen_sync_event_id (event_id),
  KEY ix_canteen_sync_client_id (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canteen_token_sequences (
  order_date DATE NOT NULL,
  last_token BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (order_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canteen_order_tokens (
  sync_id VARCHAR(64) NOT NULL,
  order_date DATE NOT NULL,
  token BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (sync_id),
  UNIQUE KEY uq_canteen_daily_token (order_date, token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
