import { describe, it, expect, vi } from "vitest";
import { resumeParseFieldsNode, type ResumeDTO } from "../../nodes/skills/resume.parse_fields.js";
import type { IRunContext } from "../../contracts/IRunContext.js";
import { UsageAccumulator } from "../../engine/UsageAccumulator.js";
import { iNodeConformanceSuite } from "../contract/INode.conformance.js";

const fakeResumeDTO: ResumeDTO = {
  name: "Jane Doe",
  experience: [
    { company: "Acme Corp", role: "Engineer", startDate: "2020-01" },
  ],
  keyProjects: ["ProjectX"],
  college: "MIT",
};

function makeCtx(dto: unknown = fakeResumeDTO): IRunContext {
  return {
    runId: "r1",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    drive: { download: vi.fn() },
    gmail: { fetchAttachment: vi.fn() },
    llm: { generateObject: vi.fn().mockResolvedValue(dto) },
    storage: { upload: vi.fn(), download: vi.fn(), delete: vi.fn() },
    usage: new UsageAccumulator(),
  };
}

const validInput = { text: "Jane Doe, Engineer at Acme Corp. Projects: ProjectX. MIT graduate." };
const invalidInput = { text: 123 }; // wrong type

iNodeConformanceSuite(
  "resume.parse_fields",
  () => resumeParseFieldsNode,
  validInput,
  invalidInput,
  makeCtx(),
);

describe("resume.parse_fields behaviour", () => {
  it("returns parsed ResumeDTO on happy path", async () => {
    const ctx = makeCtx();
    const result = await resumeParseFieldsNode.execute(validInput, ctx);
    expect(result).toEqual({ ok: true, output: fakeResumeDTO });
  });

  it("calls generateObject with correct schema and prompt", async () => {
    const ctx = makeCtx();
    await resumeParseFieldsNode.execute(validInput, ctx);
    expect(ctx.llm.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ parse: expect.any(Function) }), // Zod schema
      expect.stringContaining("resume parser"),
      validInput,
      undefined, // no node-declared preference → global default provider
      expect.any(Function), // onUsage callback wired by SkillNode
    );
  });

  it("declares no preferred LLM, deferring to the global default", () => {
    expect(resumeParseFieldsNode.preferredLLM).toBeUndefined();
  });

  it("returns OutputInvalid when LLM returns wrong shape", async () => {
    const ctx = makeCtx({ wrong: "shape" }); // missing required fields
    const result = await resumeParseFieldsNode.execute(validInput, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("OutputInvalid");
  });

  it("returns NodeError when LLM throws", async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.llm.generateObject).mockRejectedValue(new Error("rate limited"));
    const result = await resumeParseFieldsNode.execute(validInput, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("NodeError");
      expect(result.error.message).toBe("rate limited");
    }
  });
});
