-- Bheemz Kitchen: migrate in-memory state to Postgres
-- Run this once against your Render database:
--   psql "<External Database URL>" -f db_migration.sql

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    reference TEXT NOT NULL UNIQUE,
    payment_method TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'paid',
    amount NUMERIC NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'NGN',
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS bank_accounts (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    account_id TEXT NOT NULL,
    balance NUMERIC NOT NULL DEFAULT 250000,
    currency TEXT NOT NULL DEFAULT 'NGN'
);

CREATE TABLE IF NOT EXISTS bank_transactions (
    transaction_id TEXT PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    amount NUMERIC NOT NULL,
    account TEXT NOT NULL,
    created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS consultation_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    expert_id INTEGER NOT NULL,
    expert_name TEXT NOT NULL,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at BIGINT NOT NULL
);

-- Helpful indexes for lookups the app actually does
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_user_id ON bank_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_consultation_requests_user_id ON consultation_requests(user_id);
