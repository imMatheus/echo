-- Echo initial schema
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expires_idx ON sessions(expires_at);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE org_members (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX org_members_user_idx ON org_members(user_id);

CREATE TABLE scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('personal', 'organization', 'workspace', 'team', 'project')),
  name text NOT NULL,
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (type = 'personal' AND user_id IS NOT NULL AND org_id IS NULL)
    OR (type <> 'personal' AND org_id IS NOT NULL AND user_id IS NULL)
  )
);
CREATE UNIQUE INDEX scopes_personal_unique ON scopes(user_id) WHERE type = 'personal';
CREATE UNIQUE INDEX scopes_org_unique ON scopes(org_id) WHERE type = 'organization';
CREATE INDEX scopes_org_idx ON scopes(org_id);

CREATE TABLE scope_members (
  scope_id uuid NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_id, user_id)
);
CREATE INDEX scope_members_user_idx ON scope_members(user_id);

CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  source_app text NOT NULL DEFAULT 'api',
  key_prefix text NOT NULL,
  key_hash text UNIQUE NOT NULL,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX api_keys_user_idx ON api_keys(user_id);

-- The embedding column is intentionally dimension-less so any provider works.
-- Exact (non-indexed) KNN scans are fine at self-hosted memory counts; queries
-- always filter on embedding_model so vectors of different dimensions never mix.
CREATE TABLE memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id uuid NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  content text NOT NULL,
  kind text NOT NULL DEFAULT 'explicit' CHECK (kind IN ('explicit', 'inferred')),
  confidence real NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  sensitivity text NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('low', 'normal', 'high')),
  source_app text NOT NULL DEFAULT 'dashboard',
  tags text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  embedding vector,
  embedding_model text,
  tsv tsvector,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
-- Trigger rather than a generated column: tags should be searchable too, and
-- array_to_string is not IMMUTABLE so it cannot appear in a generated column.
CREATE FUNCTION memories_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.tsv := to_tsvector('english',
    coalesce(NEW.content, '') || ' ' || array_to_string(coalesce(NEW.tags, '{}'), ' '));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER memories_tsv_trigger
  BEFORE INSERT OR UPDATE OF content, tags ON memories
  FOR EACH ROW EXECUTE FUNCTION memories_tsv_update();

CREATE INDEX memories_scope_idx ON memories(scope_id) WHERE deleted_at IS NULL;
CREATE INDEX memories_tsv_idx ON memories USING gin(tsv);
CREATE INDEX memories_tags_idx ON memories USING gin(tags);
CREATE INDEX memories_created_idx ON memories(created_at DESC);

CREATE TABLE audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  source_app text NOT NULL DEFAULT 'dashboard',
  action text NOT NULL,
  memory_id uuid,
  scope_id uuid,
  org_id uuid,
  details jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_org_idx ON audit_logs(org_id, occurred_at DESC) WHERE org_id IS NOT NULL;
CREATE INDEX audit_actor_idx ON audit_logs(actor_user_id, occurred_at DESC);
CREATE INDEX audit_memory_idx ON audit_logs(memory_id) WHERE memory_id IS NOT NULL;
