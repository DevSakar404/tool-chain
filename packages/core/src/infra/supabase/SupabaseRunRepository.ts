import type { RunRecord, StepRunRecord } from "../../contracts/dtos.js";
import type { IRunRepository, StepDuration } from "../../contracts/IRepositories.js";
import { ChainError } from "../../errors/index.js";
import type { SupabaseDb } from "./SupabaseTypes.js";

export class SupabaseRunRepository implements IRunRepository {
  constructor(private readonly db: SupabaseDb) {}

  async createRun(run: RunRecord): Promise<void> {
    const { error } = await this.db.from("runs").insert({
      id: run.id,
      chain_id: run.chainId,
      status: run.status,
      trigger: run.trigger,
      created_at: run.createdAt.toISOString(),
    });
    if (error) throw new ChainError(`createRun failed: ${error.message}`, "DB_ERROR");
  }

  async updateRun(
    id: string,
    patch: Partial<Pick<RunRecord, "status" | "finishedAt" | "totalTokens">>,
  ): Promise<void> {
    const update: Record<string, unknown> = {};
    if (patch.status !== undefined) update["status"] = patch.status;
    if (patch.finishedAt !== undefined) update["finished_at"] = patch.finishedAt.toISOString();
    if (patch.totalTokens !== undefined) update["total_tokens"] = patch.totalTokens;

    const result = await this.db.from("runs").update(update).eq("id", id);
    if (result.error) throw new ChainError(`updateRun failed: ${result.error.message}`, "DB_ERROR");
  }

  async createStepRun(stepRun: StepRunRecord): Promise<void> {
    const { error } = await this.db.from("step_runs").insert({
      id: stepRun.id,
      run_id: stepRun.runId,
      step_id: stepRun.stepId,
      node_id: stepRun.nodeId,
      status: stepRun.status,
      input: stepRun.input,
      output: stepRun.output ?? null,
      error: stepRun.error ?? null,
      started_at: stepRun.startedAt.toISOString(),
      finished_at: stepRun.finishedAt.toISOString(),
    });
    if (error) throw new ChainError(`createStepRun failed: ${error.message}`, "DB_ERROR");
  }

  async updateStepRun(
    id: string,
    patch: Partial<Pick<StepRunRecord, "status" | "output" | "error" | "finishedAt">>,
  ): Promise<void> {
    const update: Record<string, unknown> = {};
    if (patch.status !== undefined) update["status"] = patch.status;
    if (patch.output !== undefined) update["output"] = patch.output;
    if (patch.error !== undefined) update["error"] = patch.error;
    if (patch.finishedAt !== undefined) update["finished_at"] = patch.finishedAt.toISOString();

    const result = await this.db.from("step_runs").update(update).eq("id", id);
    if (result.error) throw new ChainError(`updateStepRun failed: ${result.error.message}`, "DB_ERROR");
  }

  async listRecentStepDurations(chainId: string, limit: number): Promise<StepDuration[]> {
    const { data: runs, error: runsError } = await this.db
      .from("runs")
      .select("id")
      .eq("chain_id", chainId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (runsError) throw new ChainError(`listRecentStepDurations failed: ${runsError.message}`, "DB_ERROR");
    if (!runs || runs.length === 0) return [];

    const runIds = runs.map((r) => r["id"] as string);
    const { data: stepRuns, error: stepRunsError } = await this.db
      .from("step_runs")
      .select("step_id, started_at, finished_at")
      .in("run_id", runIds);
    if (stepRunsError) throw new ChainError(`listRecentStepDurations failed: ${stepRunsError.message}`, "DB_ERROR");
    if (!stepRuns) return [];

    return stepRuns.map((s) => ({
      stepId: s["step_id"] as string,
      durationMs:
        new Date(s["finished_at"] as string).getTime() - new Date(s["started_at"] as string).getTime(),
    }));
  }
}
