import { z } from "zod";

// ---------------------------------------------------------------------------
// BlobHandle — file reference flowing through the pipeline (never raw bytes)
// ---------------------------------------------------------------------------
export const BlobHandleSchema = z.object({
  storageRef: z.string(),
  mime: z.string(),
  size: z.number().int().nonnegative(),
  sha256: z.string(),
});
export type BlobHandle = z.infer<typeof BlobHandleSchema>;

// ---------------------------------------------------------------------------
// Ref — how a step's input field is sourced
// ---------------------------------------------------------------------------
export const TriggerRefSchema = z.object({ from: z.literal("trigger"), path: z.string() });
export const StepRefSchema = z.object({ from: z.string().min(1), path: z.string() });
// LiteralRef: 'value' key must be present in the object
export const LiteralRefSchema = z
  .object({ value: z.any() })
  .refine((obj) => "value" in obj, { message: "Missing required 'value' key" });

// Plain union — TriggerRef is tried first (most specific), then StepRef, then Literal
export const RefSchema = z.union([TriggerRefSchema, StepRefSchema, LiteralRefSchema]);
export type Ref = z.infer<typeof RefSchema>;

// ---------------------------------------------------------------------------
// Step — one position in a chain
// ---------------------------------------------------------------------------
export const LLMProviderNameSchema = z.enum(["anthropic", "gemini", "openrouter"]);

export const StepSchema = z.object({
  stepId: z.string().min(1),
  nodeId: z.string().min(1),
  inputMapping: z.record(z.string(), RefSchema),
  llmProvider: LLMProviderNameSchema.optional(),
});
export type Step = z.infer<typeof StepSchema>;

// ---------------------------------------------------------------------------
// Chain — DB-stored ordered pipeline definition
// ---------------------------------------------------------------------------
export const ChainSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  triggerSchemaName: z.string().optional(),
  steps: z.array(StepSchema).min(1),
  schemaVersion: z.number().int().positive(),
});
export type Chain = z.infer<typeof ChainSchema>;

// ---------------------------------------------------------------------------
// RunRecord / StepRunRecord — persisted audit
// ---------------------------------------------------------------------------
export type RunStatus = "running" | "completed" | "failed";
export type StepRunStatus = "ok" | "failed";

export interface RunRecord {
  id: string;
  chainId: string;
  status: RunStatus;
  trigger: Record<string, unknown>;
  createdAt: Date;
  finishedAt?: Date | undefined;
  /** Total LLM tokens consumed across the run's skill steps. */
  totalTokens?: number | undefined;
}

export interface StepRunRecord {
  id: string;
  runId: string;
  stepId: string;
  nodeId: string;
  status: StepRunStatus;
  input: Record<string, unknown>;
  output?: unknown | undefined;
  error?: SafeError | undefined;
  startedAt: Date;
  finishedAt: Date;
  /** Resolved provider:model label for this step's LLM call, if any. UI/logs only — not persisted to Postgres in v1. */
  llmTarget?: string | undefined;
  /** True when this step's LLM call was served by a non-first attempt (fallback). UI/logs only. */
  llmFallbackUsed?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// SafeError — the only shape persisted (D8 redaction boundary)
// ---------------------------------------------------------------------------
export interface SafeError {
  name: string;
  message: string;
  code?: string | undefined;
}

// ---------------------------------------------------------------------------
// StepResult<T> — typed outcome; not throw-only (D9)
// ---------------------------------------------------------------------------
export type StepResult<T> =
  | { ok: true; output: T }
  | {
      ok: false;
      kind: "InputInvalid" | "NodeError" | "OutputInvalid";
      error: SafeError;
    };
