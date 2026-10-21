CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE titles (
    id text PRIMARY KEY,
    version bigint NOT NULL CHECK (version > 0),
    body jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX title_name_search ON titles USING gin ((body->>'name') gin_trgm_ops);
CREATE TABLE outbox (
    id text PRIMARY KEY,
    aggregate_id text NOT NULL,
    version bigint NOT NULL,
    topic text NOT NULL,
    payload jsonb NOT NULL,
    sent boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (aggregate_id, version)
);
CREATE INDEX outbox_pending ON outbox(created_at) WHERE NOT sent;
