import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { ChainEngine } from "../../engine/ChainEngine.js";
import { NodeRegistry } from "../../registry/NodeRegistry.js";
import { ToolNode } from "../../node/ToolNode.js";
import type { Chain } from "../../contracts/dtos.js";
import type { IChainRepository, IRunRepository } from "../../contracts/IRepositories.js";
import type { IRunContext } from "../../contracts/IRunContext.js";

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
const fakeCtx: IRunContext = {
  runId: "test-run",
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  drive: { download: vi.fn() },
  llm: { generateObject: vi.fn() },
  storage: { upload: vi.fn(), download: vi.fn(), delete: vi.fn() },
};

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
      ctxFactory: () => fakeCtx,
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
      ctxFactory: () => fakeCtx,
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
      ctxFactory: () => fakeCtx,
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
