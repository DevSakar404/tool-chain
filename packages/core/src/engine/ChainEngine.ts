import { randomUUID } from "crypto";
import type { Chain, RunRecord, StepRunRecord, SafeError } from "../contracts/dtos.js";
import type { IRunContext } from "../contracts/IRunContext.js";
import type { IRunRepository, IChainRepository } from "../contracts/IRepositories.js";
import { NodeRegistry } from "../registry/NodeRegistry.js";
import { InputResolver } from "./InputResolver.js";
import { NodeNotFoundError } from "../errors/index.js";
import { toSafeError } from "../node/BaseNode.js";

export interface ChainEngineOptions {
  registry: NodeRegistry;
  chainRepo: IChainRepository;
  runRepo: IRunRepository;
  ctxFactory: (runId: string) => IRunContext;
}

export interface RunResult {
  runId: string;
  ok: boolean;
  output?: unknown;
  error?: SafeError;
  stepRuns: StepRunRecord[];
}

export class ChainEngine {
  private readonly resolver = new InputResolver();

  constructor(private readonly opts: ChainEngineOptions) {}

  async run(chainId: string, trigger: Record<string, unknown>): Promise<RunResult> {
    const chain = await this.opts.chainRepo.findById(chainId);
    if (!chain) {
      throw new NodeNotFoundError(`chain:${chainId}`);
    }

    const runId = randomUUID();
    const ctx = this.opts.ctxFactory(runId);
    const stepRuns: StepRunRecord[] = [];

    const run: RunRecord = {
      id: runId,
      chainId,
      status: "running",
      trigger,
      createdAt: new Date(),
    };
    await this.opts.runRepo.createRun(run);

    ctx.logger.info("Chain run started", { chainId, runId });

    const stepOutputs = new Map<string, unknown>();
    let lastOutput: unknown = undefined;

    for (const step of chain.steps) {
      const stepRunId = randomUUID();
      const startedAt = new Date();

      // Resolve inputs
      let resolvedInput: Record<string, unknown>;
      try {
        resolvedInput = this.resolver.resolve(step.inputMapping, trigger, stepOutputs);
      } catch (e) {
        const error = toSafeError(e);
        const stepRun = this.makeStepRun(stepRunId, runId, step.stepId, step.nodeId, "failed", {}, undefined, error, startedAt);
        stepRuns.push(stepRun);
        await this.opts.runRepo.createStepRun(stepRun);
        await this.opts.runRepo.updateRun(runId, { status: "failed", finishedAt: new Date() });
        ctx.logger.error("Input resolution failed", { stepId: step.stepId, error });
        return { runId, ok: false, error, stepRuns };
      }

      // Get node
      let node;
      try {
        node = this.opts.registry.get(step.nodeId);
      } catch (e) {
        const error = toSafeError(e);
        const stepRun = this.makeStepRun(stepRunId, runId, step.stepId, step.nodeId, "failed", resolvedInput, undefined, error, startedAt);
        stepRuns.push(stepRun);
        await this.opts.runRepo.createStepRun(stepRun);
        await this.opts.runRepo.updateRun(runId, { status: "failed", finishedAt: new Date() });
        return { runId, ok: false, error, stepRuns };
      }

      // Execute node
      const result = await node.execute(resolvedInput, ctx);
      const finishedAt = new Date();

      if (result.ok) {
        const stepRun = this.makeStepRun(stepRunId, runId, step.stepId, step.nodeId, "ok", resolvedInput, result.output, undefined, startedAt, finishedAt);
        stepRuns.push(stepRun);
        await this.opts.runRepo.createStepRun(stepRun);
        stepOutputs.set(step.stepId, result.output);
        lastOutput = result.output;
        ctx.logger.info("Step ok", { stepId: step.stepId, nodeId: step.nodeId });
      } else {
        // Redacted error — only SafeError persisted (D8)
        const stepRun = this.makeStepRun(stepRunId, runId, step.stepId, step.nodeId, "failed", resolvedInput, undefined, result.error, startedAt, finishedAt);
        stepRuns.push(stepRun);
        await this.opts.runRepo.createStepRun(stepRun);
        await this.opts.runRepo.updateRun(runId, { status: "failed", finishedAt: new Date() });
        ctx.logger.error("Step failed", { stepId: step.stepId, kind: result.kind, error: result.error });
        return { runId, ok: false, error: result.error, stepRuns };
      }
    }

    await this.opts.runRepo.updateRun(runId, { status: "completed", finishedAt: new Date() });
    ctx.logger.info("Chain run completed", { runId });
    return { runId, ok: true, output: lastOutput, stepRuns };
  }

  private makeStepRun(
    id: string,
    runId: string,
    stepId: string,
    nodeId: string,
    status: "ok" | "failed",
    input: Record<string, unknown>,
    output: unknown,
    error: SafeError | undefined,
    startedAt: Date,
    finishedAt: Date = new Date(),
  ): StepRunRecord {
    const record: StepRunRecord = { id, runId, stepId, nodeId, status, input, startedAt, finishedAt };
    if (output !== undefined) record.output = output;
    if (error !== undefined) record.error = error;
    return record;
  }
}
