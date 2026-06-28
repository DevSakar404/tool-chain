import type { Chain, RunRecord, StepRunRecord } from "./dtos.js";

export interface IChainRepository {
  findById(id: string): Promise<Chain | null>;
  save(chain: Chain): Promise<void>;
}

export interface IRunRepository {
  createRun(run: RunRecord): Promise<void>;
  updateRun(id: string, patch: Partial<Pick<RunRecord, "status" | "finishedAt">>): Promise<void>;
  createStepRun(stepRun: StepRunRecord): Promise<void>;
  updateStepRun(
    id: string,
    patch: Partial<Pick<StepRunRecord, "status" | "output" | "error" | "finishedAt">>,
  ): Promise<void>;
}
