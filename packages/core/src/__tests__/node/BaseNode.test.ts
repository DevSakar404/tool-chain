import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ToolNode } from "../../node/ToolNode.js";
import { SkillNode } from "../../node/SkillNode.js";
import type { IRunContext } from "../../contracts/IRunContext.js";
import { UsageAccumulator } from "../../engine/UsageAccumulator.js";
import { LLMCallTrace } from "../../engine/LLMCallTrace.js";

const noopCtx: IRunContext = {
  runId: "test-run",
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  drive: { download: vi.fn() },
  gmail: { fetchAttachment: vi.fn() },
  llm: { generateObject: vi.fn() },
  storage: { upload: vi.fn(), download: vi.fn(), delete: vi.fn() },
  usage: new UsageAccumulator(),
  llmTrace: new LLMCallTrace(),
};

const inputSchema = z.object({ value: z.number() });
const outputSchema = z.object({ doubled: z.number() });

describe("ToolNode", () => {
  it("returns ok:true on happy path", async () => {
    const node = new ToolNode(
      "test.double",
      inputSchema,
      outputSchema,
      async (input) => ({ doubled: input.value * 2 }),
    );
    const result = await node.execute({ value: 5 }, noopCtx);
    expect(result).toEqual({ ok: true, output: { doubled: 10 } });
  });

  it("returns InputInvalid when input schema fails", async () => {
    const node = new ToolNode(
      "test.double",
      inputSchema,
      outputSchema,
      async (input) => ({ doubled: input.value * 2 }),
    );
    const result = await node.execute({ value: "not-a-number" }, noopCtx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("InputInvalid");
  });

  it("returns NodeError when handler throws", async () => {
    const node = new ToolNode(
      "test.failing",
      inputSchema,
      outputSchema,
      async () => { throw new Error("handler boom"); },
    );
    const result = await node.execute({ value: 1 }, noopCtx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("NodeError");
      expect(result.error.message).toBe("handler boom");
    }
  });

  it("returns OutputInvalid when handler returns wrong shape", async () => {
    const node = new ToolNode(
      "test.wrong-output",
      inputSchema,
      outputSchema,
      // @ts-expect-error intentionally wrong
      async () => ({ wrong: "field" }),
    );
    const result = await node.execute({ value: 1 }, noopCtx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("OutputInvalid");
  });

  it("error.name is never undefined in failure", async () => {
    const node = new ToolNode("t", inputSchema, outputSchema, async () => { throw "string error"; });
    const result = await node.execute({ value: 1 }, noopCtx);
    if (!result.ok) expect(result.error.name).toBeDefined();
  });
});

describe("SkillNode", () => {
  it("delegates to ctx.llm.generateObject on happy path", async () => {
    const generateObject = vi.fn().mockResolvedValue({ doubled: 99 });
    const ctx = { ...noopCtx, llm: { generateObject } };
    const node = new SkillNode(
      "test.skill",
      inputSchema,
      outputSchema,
      "You double numbers",
    );
    const result = await node.execute({ value: 5 }, ctx);
    expect(generateObject).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, output: { doubled: 99 } });
  });

  it("returns NodeError when llm throws", async () => {
    const ctx = {
      ...noopCtx,
      llm: { generateObject: vi.fn().mockRejectedValue(new Error("LLM timeout")) },
    };
    const node = new SkillNode("test.skill", inputSchema, outputSchema, "prompt");
    const result = await node.execute({ value: 1 }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("NodeError");
      expect(result.error.message).toBe("LLM timeout");
    }
  });

  describe("provider precedence: step override → node preferredLLM → undefined", () => {
    it("step override wins over the node's preferredLLM", async () => {
      const generateObject = vi.fn().mockResolvedValue({ doubled: 1 });
      const ctx = { ...noopCtx, llm: { generateObject } };
      const node = new SkillNode(
        "test.skill",
        inputSchema,
        outputSchema,
        "prompt",
        undefined,
        { provider: "anthropic" },
      );
      await node.execute({ value: 1 }, ctx, { llmProvider: "gemini" });
      expect(generateObject).toHaveBeenCalledWith(
        outputSchema,
        "prompt",
        { value: 1 },
        { provider: "gemini" },
        expect.any(Function),
      );
    });

    it("falls back to the node's preferredLLM when no step override is given", async () => {
      const generateObject = vi.fn().mockResolvedValue({ doubled: 1 });
      const ctx = { ...noopCtx, llm: { generateObject } };
      const node = new SkillNode(
        "test.skill",
        inputSchema,
        outputSchema,
        "prompt",
        undefined,
        { provider: "anthropic" },
      );
      await node.execute({ value: 1 }, ctx);
      expect(generateObject).toHaveBeenCalledWith(
        outputSchema,
        "prompt",
        { value: 1 },
        { provider: "anthropic" },
        expect.any(Function),
      );
    });

    it("passes undefined when neither a step override nor a node preference is set", async () => {
      const generateObject = vi.fn().mockResolvedValue({ doubled: 1 });
      const ctx = { ...noopCtx, llm: { generateObject } };
      const node = new SkillNode("test.skill", inputSchema, outputSchema, "prompt");
      await node.execute({ value: 1 }, ctx);
      expect(generateObject).toHaveBeenCalledWith(
        outputSchema,
        "prompt",
        { value: 1 },
        undefined,
        expect.any(Function),
      );
    });
  });
});
