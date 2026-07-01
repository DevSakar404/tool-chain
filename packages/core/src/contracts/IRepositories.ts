import type { Chain, RunRecord, StepRunRecord } from "./dtos.js";

export interface IChainRepository {
  findById(id: string): Promise<Chain | null>;
  save(chain: Chain): Promise<void>;
}

export interface IRunRepository {
  createRun(run: RunRecord): Promise<void>;
  updateRun(
    id: string,
    patch: Partial<Pick<RunRecord, "status" | "finishedAt" | "totalTokens">>,
  ): Promise<void>;
  createStepRun(stepRun: StepRunRecord): Promise<void>;
  updateStepRun(
    id: string,
    patch: Partial<Pick<StepRunRecord, "status" | "output" | "error" | "finishedAt">>,
  ): Promise<void>;
  /**
   * Step durations from the most recent `limit` runs of a chain. Used to
   * compute historical per-step average durations for the editor's progress
   * bar. `stepId` is stable across runs of the same chain (e.g. "s1", "s2"),
   * so callers group by it.
   */
  listRecentStepDurations(chainId: string, limit: number): Promise<StepDuration[]>;
}

export interface StepDuration {
  stepId: string;
  durationMs: number;
}
