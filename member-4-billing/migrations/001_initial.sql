CREATE TABLE IF NOT EXISTS records (
  id varchar(128) PRIMARY KEY,
  account_id varchar(128) NOT NULL,
  kind varchar(40) NOT NULL,
  body JSON NOT NULL,
  INDEX account_kind (account_id,kind)
);
CREATE TABLE IF NOT EXISTS locks (id varchar(191) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS inbox (id varchar(191) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS idempotency (
  id varchar(191) PRIMARY KEY,
  request_hash char(64) NOT NULL,
  resource_id varchar(128) NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  id varchar(191) PRIMARY KEY,
  destination varchar(80) NOT NULL,
  transport varchar(12) NOT NULL,
  payload JSON NOT NULL,
  sent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX pending (sent,created_at)
);
