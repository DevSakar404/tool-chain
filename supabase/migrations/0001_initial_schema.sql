-- Migration: 0001_initial_schema
-- chains, runs, step_runs tables + pipeline-blobs storage bucket

-- ============================================================
-- chains
-- ============================================================
CREATE TABLE IF NOT EXISTS chains (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  trigger_schema_name TEXT,
  steps            JSONB NOT NULL DEFAULT '[]',
  schema_version   INTEGER NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- runs
-- ============================================================
CREATE TYPE run_status AS ENUM ('running', 'completed', 'failed');

CREATE TABLE IF NOT EXISTS runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id    UUID NOT NULL REFERENCES chains(id) ON DELETE CASCADE,
  status      run_status NOT NULL DEFAULT 'running',
  trigger     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS runs_chain_id_idx ON runs(chain_id);
CREATE INDEX IF NOT EXISTS runs_status_idx ON runs(status);

-- ============================================================
-- step_runs
-- ============================================================
CREATE TYPE step_run_status AS ENUM ('ok', 'failed');

CREATE TABLE IF NOT EXISTS step_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step_id     TEXT NOT NULL,
  node_id     TEXT NOT NULL,
  status      step_run_status NOT NULL,
  input       JSONB NOT NULL DEFAULT '{}',
  output      JSONB,
  error       JSONB,            -- only { name, message, code } ever persisted (D8 redaction)
  started_at  TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS step_runs_run_id_idx ON step_runs(run_id);

-- ============================================================
-- Storage bucket (run via Supabase dashboard or supabase CLI)
-- ============================================================
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('pipeline-blobs', 'pipeline-blobs', false)
-- ON CONFLICT (id) DO NOTHING;
--
-- Note: Bucket creation requires storage admin role.
-- If using supabase CLI: supabase storage create pipeline-blobs
