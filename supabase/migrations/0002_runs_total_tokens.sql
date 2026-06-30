-- Migration: 0002_runs_total_tokens
-- Record total LLM token usage per run (sum across skill steps).
-- Defaults to 0 so historical rows and chains with no skill steps are valid.

ALTER TABLE runs ADD COLUMN IF NOT EXISTS total_tokens INTEGER NOT NULL DEFAULT 0;
