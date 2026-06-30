import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { ChainEngine } from "../../engine/ChainEngine.js";
import { NodeRegistry } from "../../registry/NodeRegistry.js";
import { ToolNode } from "../../node/ToolNode.js";
import { SkillNode } from "../../node/SkillNode.js";
import { UsageAccumulator } from "../../engine/UsageAccumulator.js";
import type { Chain } from "../../contracts/dtos.js";
import type { IChainRepository, IRunRepository } from "../../contracts/IRepositories.js";
import type { IRunContext, TokenUsage } from "../../contracts/IRunContext.js";

// ── fake nodes ────────────────────────────────────────────────────────────────
const nodeA = new ToolNode(
  "test.nodeA",
  z.object({ value: z.number() }),
  z.object({ doubled: z.number() }),
  async (input) => ({ doubled: input.value * 2 }),
);

const nodeB = new ToolNode(
  "test.nodeB",
  z.object({ doubled: z.number() }),
  z.object({ result: z.string() }),
  async (input) => ({ result: `result-${input.doubled}` }),
);

// ── fake chain ────────────────────────────────────────────────────────────────
const fakeChain: Chain = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Golden chain",
  schemaVersion: 1,
  steps: [
    {
      stepId: "s1",
      nodeId: "test.nodeA",
      inputMapping: { value: { from: "trigger", path: "value" } },
    },
    {
      stepId: "s2",
      nodeId: "test.nodeB",
      inputMapping: { doubled: { from: "s1", path: "doubled" } },
    },
  ],
};

// ── fake repos ─────────────────────────────────────────────────────────────────
function makeFakeRepos(): { chainRepo: IChainRepository; runRepo: IRunRepository } {
  const stepRuns: unknown[] = [];
  const runs: unknown[] = [];
  return {
    chainRepo: {
      findById: vi.fn().mockResolvedValue(fakeChain),
      save: vi.fn(),
    },
    runRepo: {
      createRun: vi.fn().mockImplementation(async (r) => runs.push(r)),
      updateRun: vi.fn(),
      createStepRun: vi.fn().mockImplementation(async (s) => stepRuns.push(s)),
      updateStepRun: vi.fn(),
    },
  };
}

// ── fake context ───────────────────────────────────────────────────────────────
// A fresh UsageAccumulator per run keeps token totals isolated between tests.
function makeFakeCtx(): IRunContext {
  return {
    runId: "test-run",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    drive: { download: vi.fn() },
    llm: { generateObject: vi.fn() },
    storage: { upload: vi.fn(), download: vi.fn(), delete: vi.fn() },
    usage: new UsageAccumulator(),
  };
}

// ── tests ──────────────────────────────────────────────────────────────────────
describe("ChainEngine golden path", () => {
  let registry: NodeRegistry;
  let engine: ChainEngine;
  let runRepo: IRunRepository;
  let chainRepo: IChainRepository;

  beforeEach(() => {
    registry = new NodeRegistry();
    registry.register(nodeA);
    registry.register(nodeB);
    const repos = makeFakeRepos();
    runRepo = repos.runRepo;
    chainRepo = repos.chainRepo;
    engine = new ChainEngine({
      registry,
      chainRepo,
      runRepo,
      ctxFactory: () => makeFakeCtx(),
    });
  });

  it("runs both steps and returns final output", async () => {
    const result = await engine.run(fakeChain.id, { value: 7 });
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ result: "result-14" });
  });

  it("persists a StepRun for each step", async () => {
    await engine.run(fakeChain.id, { value: 7 });
    expect(runRepo.createStepRun).toHaveBeenCalledTimes(2);
  });

  it("propagates A's output into B's input correctly", async () => {
    const result = await engine.run(fakeChain.id, { value: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toEqual({ result: "result-10" });
  });

  it("short-circuits on first step failure and persists error", async () => {
    const failingNode = new ToolNode(
      "test.nodeA",
      z.object({ value: z.number() }),
      z.object({ doubled: z.number() }),
      async () => { throw new Error("boom"); },
    );
    const reg = new NodeRegistry();
    reg.register(failingNode);
    reg.register(nodeB);
    const repos = makeFakeRepos();
    const eng = new ChainEngine({
      registry: reg,
      chainRepo: repos.chainRepo,
      runRepo: repos.runRepo,
      ctxFactory: () => makeFakeCtx(),
    });
    const result = await eng.run(fakeChain.id, { value: 1 });
    expect(result.ok).toBe(false);
    // Only 1 stepRun created (second step never reached)
    expect(repos.runRepo.createStepRun).toHaveBeenCalledTimes(1);
  });

  it("persisted error contains only name+message (no raw secrets)", async () => {
    const secretError = new Error("secret-key-12345");
    secretError.name = "SecretLeakError";
    const failingNode = new ToolNode(
      "test.nodeA",
      z.object({ value: z.number() }),
      z.object({ doubled: z.number() }),
      async () => { throw secretError; },
    );
    const reg = new NodeRegistry();
    reg.register(failingNode);
    reg.register(nodeB);
    const repos = makeFakeRepos();
    const eng = new ChainEngine({
      registry: reg,
      chainRepo: repos.chainRepo,
      runRepo: repos.runRepo,
      ctxFactory: () => makeFakeCtx(),
    });
    const result = await eng.run(fakeChain.id, { value: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error?.name).toBe("SecretLeakError");
      // Only these 3 fields — no stack, no extra props
      const keys = Object.keys(result.error ?? {});
      const allowed = new Set(["name", "message", "code"]);
      keys.forEach(k => expect(allowed.has(k)).toBe(true));
    }
  });
});

// ── token usage ─────────────────────────────────────────────────────────────────
describe("ChainEngine token usage", () => {
  // A skill node whose fake LLM reports usage via the onUsage callback.
  const skillChain: Chain = {
    id: "00000000-0000-0000-0000-000000000002",
    name: "Skill chain",
    schemaVersion: 1,
    steps: [
      {
        stepId: "s1",
        nodeId: "test.skillA",
        inputMapping: { value: { from: "trigger", path: "value" } },
      },
      {
        stepId: "s2",
        nodeId: "test.skillB",
        inputMapping: { value: { from: "trigger", path: "value" } },
      },
    ],
  };

  // generateObject that returns a fixed object and reports a fixed usage.
  function fakeGenerateObject(output: unknown, usage: TokenUsage) {
    return vi.fn(
      async (
        _schema: unknown,
        _system: unknown,
        _input: unknown,
        _prefer: unknown,
        onUsage?: (u: TokenUsage) => void,
      ) => {
        onUsage?.(usage);
        return output;
      },
    );
  }

  const skillA = new SkillNode(
    "test.skillA",
    z.object({ value: z.number() }),
    z.object({ ok: z.boolean() }),
    "system-a",
  );
  const skillB = new SkillNode(
    "test.skillB",
    z.object({ value: z.number() }),
    z.object({ ok: z.boolean() }),
    "system-b",
  );

  function buildEngineWithUsage(generateObject: ReturnType<typeof vi.fn>) {
    const reg = new NodeRegistry();
    reg.register(skillA);
    reg.register(skillB);
    const repos = makeFakeRepos();
    // skillChain must resolve, not fakeChain.
    vi.mocked(repos.chainRepo.findById).mockResolvedValue(skillChain);
    const usage = new UsageAccumulator();
    const ctx: IRunContext = {
      runId: "test-run",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      drive: { download: vi.fn() },
      llm: { generateObject },
      storage: { upload: vi.fn(), download: vi.fn(), delete: vi.fn() },
      usage,
    };
    const engine = new ChainEngine({
      registry: reg,
      chainRepo: repos.chainRepo,
      runRepo: repos.runRepo,
      ctxFactory: () => ctx,
    });
    return { engine, runRepo: repos.runRepo };
  }

  it("sums token usage across skill steps onto RunResult.totalTokens", async () => {
    const generateObject = fakeGenerateObject(
      { ok: true },
      { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
    );
    const { engine } = buildEngineWithUsage(generateObject);

    const result = await engine.run(skillChain.id, { value: 1 });

    expect(result.ok).toBe(true);
    // Two skill steps × 50 tokens each.
    expect(result.totalTokens).toBe(100);
  });

  it("persists totalTokens on the completed run", async () => {
    const generateObject = fakeGenerateObject(
      { ok: true },
      { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
    );
    const { engine, runRepo } = buildEngineWithUsage(generateObject);

    await engine.run(skillChain.id, { value: 1 });

    expect(runRepo.updateRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "completed", totalTokens: 100 }),
    );
  });

  it("reports zero tokens for a chain with no skill steps", async () => {
    const repos = makeFakeRepos(); // resolves fakeChain (two ToolNodes)
    const reg = new NodeRegistry();
    reg.register(nodeA);
    reg.register(nodeB);
    const engine = new ChainEngine({
      registry: reg,
      chainRepo: repos.chainRepo,
      runRepo: repos.runRepo,
      ctxFactory: () => makeFakeCtx(),
    });

    const result = await engine.run(fakeChain.id, { value: 7 });

    expect(result.ok).toBe(true);
    expect(result.totalTokens).toBe(0);
  });
});
