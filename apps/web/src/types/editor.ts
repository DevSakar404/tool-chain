import type { Chain, NodeCatalogEntry } from "@tool-chain/core";

export type StepStatus = "pending" | "running" | "ok" | "error";

export interface FieldValidation {
  fieldName: string;
  problem: "needs-wiring" | "dangling-ref";
}

export interface StepValidation {
  stepId: string;
  fields: FieldValidation[];
}

export interface ValidationState {
  steps: StepValidation[];
  /** true when every step has no field problems */
  valid: boolean;
}

export interface RunState {
  active: boolean;
  stepStatuses: Record<string, StepStatus>;
  result: unknown;
  error: string | null;
  /** Total LLM tokens for the last run; null when unknown / not yet run. */
  totalTokens: number | null;
}

export interface EditorState {
  chain: Chain | null;
  catalog: NodeCatalogEntry[];
  selectedStepId: string | null;
  dirty: boolean;
  validation: ValidationState;
  trigger: Record<string, unknown>;
  run: RunState;
  loadError: string | null;
  /** Historical average duration (ms) per stepId, from past runs. Empty until loaded or if there's no history yet. */
  stepAverages: Record<string, number>;
}
