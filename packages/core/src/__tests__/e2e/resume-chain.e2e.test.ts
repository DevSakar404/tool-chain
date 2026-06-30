import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { NodeRegistry } from "../../registry/NodeRegistry.js";
import { ChainEngine } from "../../engine/ChainEngine.js";
import { registerAll } from "../../nodes/index.js";
import { ResumeDTOSchema, type ResumeDTO } from "../../nodes/skills/resume.parse_fields.js";
import type { IChainRepository, IRunRepository } from "../../contracts/IRepositories.js";
import type { IRunContext, TokenUsage } from "../../contracts/IRunContext.js";
import type { BlobHandle, Chain } from "../../contracts/dtos.js";
import { ChainSchema } from "../../contracts/dtos.js";
import { UsageAccumulator } from "../../engine/UsageAccumulator.js";

// ── Load fixtures ─────────────────────────────────────────────────────────────
const fixturesDir = resolve(process.cwd(), "../../fixtures");

const resumeText = readFileSync(resolve(fixturesDir, "drive-file.txt"), "utf-8");
const chainFixture: Chain = ChainSchema.parse(
  JSON.parse(readFileSync(resolve(fixturesDir, "resume-chain.json"), "utf-8")),
);
const cassette: ResumeDTO = ResumeDTOSchema.parse(
  JSON.parse(readFileSync(resolve(fixturesDir, "llm-cassette.json"), "utf-8")),
);

// ── Fake blob handle ──────────────────────────────────────────────────────────
const fakeBlob: BlobHandle = {
  storageRef: "pipeline-blobs/test-file.txt",
  mime: "text/plain",
  size: resumeText.length,
  sha256: "fixture-sha256",
};

// Usage the cassette "reports" so the e2e proves token totals flow end-to-end.
const CASSETTE_USAGE: TokenUsage = { promptTokens: 800, completionTokens: 120, totalTokens: 920 };

// ── Fixture-backed mocks ──────────────────────────────────────────────────────
const stepRuns: unknown[] = [];
const runs: unknown[] = [];

const fakeChainRepo: IChainRepository = {
  findById: vi.fn().mockResolvedValue(chainFixture),
  save: vi.fn(),
};

const fakeRunRepo: IRunRepository = {
  createRun: vi.fn().mockImplementation(async (r) => { runs.push(r); }),
  updateRun: vi.fn(),
  createStepRun: vi.fn().mockImplementation(async (s) => { stepRuns.push(s); }),
  updateStepRun: vi.fn(),
};

function makeFakeCtx(runId: string): IRunContext {
  return {
    runId,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    drive: {
      download: vi.fn().mockResolvedValue(fakeBlob),
    },
    llm: {
      // Mirror the real provider: return the object and report usage via onUsage.
      generateObject: vi.fn(
        async (
          _schema: unknown,
          _system: unknown,
          _input: unknown,
          _prefer: unknown,
          onUsage?: (u: TokenUsage) => void,
        ): Promise<unknown> => {
          onUsage?.(CASSETTE_USAGE);
          return cassette;
        },
      ) as IRunContext["llm"]["generateObject"],
    },
    storage: {
      upload: vi.fn().mockResolvedValue(fakeBlob.storageRef),
      download: vi.fn().mockResolvedValue(Buffer.from(resumeText, "utf-8")),
      delete: vi.fn(),
    },
    usage: new UsageAccumulator(),
  };
}

// ── Build engine ──────────────────────────────────────────────────────────────
function buildTestEngine() {
  const registry = new NodeRegistry();
  registerAll(registry);

  return new ChainEngine({
    registry,
    chainRepo: fakeChainRepo,
    runRepo: fakeRunRepo,
    ctxFactory: makeFakeCtx,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("e2e: resume-chain", () => {
  beforeEach(() => {
    stepRuns.length = 0;
    runs.length = 0;
    vi.mocked(fakeRunRepo.createStepRun).mockClear();
    vi.mocked(fakeRunRepo.createRun).mockClear();
    vi.mocked(fakeRunRepo.updateRun).mockClear();
  });
  it("runs full chain and returns valid ResumeDTO", async () => {
    const engine = buildTestEngine();
    const result = await engine.run(chainFixture.id, { fileId: "fixture-file-id" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok:true");

    const parsed = ResumeDTOSchema.safeParse(result.output);
    expect(parsed.success).toBe(true);

    if (parsed.success) {
      expect(parsed.data.name).toBe("Jane Doe");
      expect(parsed.data.college).toContain("MIT");
      expect(parsed.data.experience.length).toBeGreaterThan(0);
      expect(parsed.data.keyProjects.length).toBeGreaterThan(0);
    }
  });

  it("reports non-zero total token usage from the skill step", async () => {
    const engine = buildTestEngine();
    const result = await engine.run(chainFixture.id, { fileId: "fixture-file-id" });

    expect(result.ok).toBe(true);
    // The chain has one skill step (resume.parse_fields) reporting CASSETTE_USAGE.
    expect(result.totalTokens).toBe(CASSETTE_USAGE.totalTokens);
  });

  it("persists a StepRun for each of the 3 steps", async () => {
    stepRuns.length = 0;
    const engine = buildTestEngine();
    await engine.run(chainFixture.id, { fileId: "fixture-file-id" });
    expect(fakeRunRepo.createStepRun).toHaveBeenCalledTimes(3);
  });

  it("StepRun output for s1 contains BlobHandle (not raw bytes)", async () => {
    stepRuns.length = 0;
    const engine = buildTestEngine();
    await engine.run(chainFixture.id, { fileId: "fixture-file-id" });

    const s1Run = (stepRuns as Array<{ stepId: string; output: unknown }>).find(
      (s) => s.stepId === "s1",
    );
    expect(s1Run).toBeDefined();
    const output = s1Run?.output as BlobHandle;
    expect(output?.storageRef).toBeDefined();
    expect(output?.sha256).toBeDefined();
    // No raw bytes — size should be a number, not a Buffer
    expect(typeof output?.size).toBe("number");
  });

  it("no raw secrets in any persisted StepRun error fields", async () => {
    stepRuns.length = 0;
    const engine = buildTestEngine();
    await engine.run(chainFixture.id, { fileId: "fixture-file-id" });

    for (const sr of stepRuns as Array<{ error?: unknown }>) {
      if (!sr.error) continue;
      const err = sr.error as Record<string, unknown>;
      const keys = Object.keys(err);
      const allowed = new Set(["name", "message", "code"]);
      keys.forEach((k) => expect(allowed.has(k)).toBe(true));
    }
  });
});
