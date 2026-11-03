-- Dedicated receiver database only. Never apply to the local trading database.
CREATE SCHEMA IF NOT EXISTS bar_owner;
REVOKE ALL ON SCHEMA bar_owner FROM PUBLIC;
CREATE TABLE bar_owner.accounts (
 id uuid PRIMARY KEY, email text UNIQUE NOT NULL, verifier jsonb NOT NULL,
 verified_at timestamptz, failed_logins integer NOT NULL DEFAULT 0,
 locked_until timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bar_owner.email_challenges (
 token_hash text PRIMARY KEY, owner_id uuid NOT NULL REFERENCES bar_owner.accounts(id),
 expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE bar_owner.sessions (
 token_hash text PRIMARY KEY, owner_id uuid NOT NULL REFERENCES bar_owner.accounts(id),
 expires_at timestamptz NOT NULL
);
CREATE TABLE bar_owner.enrollments (
 code_hash text PRIMARY KEY, owner_id uuid NOT NULL REFERENCES bar_owner.accounts(id),
 expires_at timestamptz NOT NULL, claimed_key_id text
);
CREATE TABLE bar_owner.links (
 key_id text PRIMARY KEY CHECK (key_id ~ '^[A-Za-z0-9._:-]{1,120}$'), owner_id uuid NOT NULL REFERENCES bar_owner.accounts(id),
 authority_id uuid UNIQUE NOT NULL, business_id uuid NOT NULL, outlet_id uuid NOT NULL,
 business_name text NOT NULL, secret_box text NOT NULL, request_hash text NOT NULL,
 active boolean NOT NULL DEFAULT false, revoked boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz
);
CREATE TABLE bar_owner.audit (
 id bigserial PRIMARY KEY, owner_id uuid REFERENCES bar_owner.accounts(id),
 action text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ALL TABLES IN SCHEMA bar_owner FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA bar_owner FROM PUBLIC;
ALTER TABLE bar_owner.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bar_owner.email_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE bar_owner.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bar_owner.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE bar_owner.links ENABLE ROW LEVEL SECURITY;
ALTER TABLE bar_owner.audit ENABLE ROW LEVEL SECURITY;
