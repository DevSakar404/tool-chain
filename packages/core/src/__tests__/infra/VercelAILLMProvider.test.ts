import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// Mock the AI SDK so no network calls happen — we drive primary success/failure.
const generateObjectMock = vi.fn();
vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
}));

// Mock provider factories so createLLMModel returns cheap sentinels we can identify.
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (model: string) => ({ __provider: "anthropic", model }),
}));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => (model: string) => ({ __provider: "gemini", model }),
}));

import { VercelAILLMProvider } from "../../infra/llm/VercelAILLMProvider.js";

const schema = z.object({ ok: z.boolean() });
const SYSTEM = "system";
const INPUT = { hello: "world" };

beforeEach(() => {
  generateObjectMock.mockReset();
});

describe("VercelAILLMProvider", () => {
  it("uses the primary provider on success", async () => {
    generateObjectMock.mockResolvedValueOnce({ object: { ok: true } });
    const llm = new VercelAILLMProvider({
      primary: { provider: "anthropic", apiKey: "k" },
    });

    const result = await llm.generateObject(schema, SYSTEM, INPUT);

    expect(result).toEqual({ ok: true });
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    expect(generateObjectMock.mock.calls[0]?.[0].model).toMatchObject({ __provider: "anthropic" });
  });

  it("falls back to the secondary provider when primary throws", async () => {
    generateObjectMock
      .mockRejectedValueOnce(new Error("invalid x-api-key"))
      .mockResolvedValueOnce({ object: { ok: true } });
    const warn = vi.fn();
    const llm = new VercelAILLMProvider({
      primary: { provider: "anthropic", apiKey: "bad" },
      fallback: { provider: "gemini", apiKey: "good" },
      logger: { info: vi.fn(), warn, error: vi.fn() },
    });

    const result = await llm.generateObject(schema, SYSTEM, INPUT);

    expect(result).toEqual({ ok: true });
    expect(generateObjectMock).toHaveBeenCalledTimes(2);
    expect(generateObjectMock.mock.calls[1]?.[0].model).toMatchObject({ __provider: "gemini" });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("rethrows the primary error when no fallback is configured", async () => {
    generateObjectMock.mockRejectedValueOnce(new Error("invalid x-api-key"));
    const llm = new VercelAILLMProvider({
      primary: { provider: "anthropic", apiKey: "bad" },
    });

    await expect(llm.generateObject(schema, SYSTEM, INPUT)).rejects.toThrow("invalid x-api-key");
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
  });

  it("propagates the fallback error if the fallback also fails", async () => {
    generateObjectMock
      .mockRejectedValueOnce(new Error("primary down"))
      .mockRejectedValueOnce(new Error("fallback down"));
    const llm = new VercelAILLMProvider({
      primary: { provider: "anthropic", apiKey: "bad" },
      fallback: { provider: "gemini", apiKey: "alsobad" },
    });

    await expect(llm.generateObject(schema, SYSTEM, INPUT)).rejects.toThrow("fallback down");
    expect(generateObjectMock).toHaveBeenCalledTimes(2);
  });

  it("tries a node's preferred provider before the global primary", async () => {
    generateObjectMock.mockResolvedValueOnce({ object: { ok: true } });
    const llm = new VercelAILLMProvider({
      primary: { provider: "anthropic", apiKey: "anthropic-key" },
      apiKeys: { anthropic: "anthropic-key", gemini: "gemini-key" },
    });

    const result = await llm.generateObject(schema, SYSTEM, INPUT, { provider: "gemini" });

    expect(result).toEqual({ ok: true });
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    expect(generateObjectMock.mock.calls[0]?.[0].model).toMatchObject({ __provider: "gemini" });
  });

  it("falls through from a failed preference to the global chain", async () => {
    generateObjectMock
      .mockRejectedValueOnce(new Error("gemini down"))
      .mockResolvedValueOnce({ object: { ok: true } });
    const llm = new VercelAILLMProvider({
      primary: { provider: "anthropic", apiKey: "anthropic-key" },
      apiKeys: { anthropic: "anthropic-key", gemini: "gemini-key" },
    });

    const result = await llm.generateObject(schema, SYSTEM, INPUT, { provider: "gemini" });

    expect(result).toEqual({ ok: true });
    expect(generateObjectMock).toHaveBeenCalledTimes(2);
    expect(generateObjectMock.mock.calls[0]?.[0].model).toMatchObject({ __provider: "gemini" });
    expect(generateObjectMock.mock.calls[1]?.[0].model).toMatchObject({ __provider: "anthropic" });
  });

  it("skips a preferred provider that has no API key and uses the primary", async () => {
    generateObjectMock.mockResolvedValueOnce({ object: { ok: true } });
    const warn = vi.fn();
    const llm = new VercelAILLMProvider({
      primary: { provider: "anthropic", apiKey: "anthropic-key" },
      // no gemini key supplied
      logger: { info: vi.fn(), warn, error: vi.fn() },
    });

    const result = await llm.generateObject(schema, SYSTEM, INPUT, { provider: "gemini" });

    expect(result).toEqual({ ok: true });
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    expect(generateObjectMock.mock.calls[0]?.[0].model).toMatchObject({ __provider: "anthropic" });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("does not retry the same target twice when preference equals primary", async () => {
    generateObjectMock.mockRejectedValueOnce(new Error("anthropic down"));
    const llm = new VercelAILLMProvider({
      primary: { provider: "anthropic", apiKey: "anthropic-key" },
      apiKeys: { anthropic: "anthropic-key" },
    });

    await expect(
      llm.generateObject(schema, SYSTEM, INPUT, { provider: "anthropic" }),
    ).rejects.toThrow("anthropic down");
    // preference and primary collapse to one attempt
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
  });

  it("reports usage via onResult on a successful call", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: { ok: true },
      usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
      response: { id: "msg_abc", headers: {} },
    });
    const onResult = vi.fn();
    const llm = new VercelAILLMProvider({
      primary: { provider: "anthropic", apiKey: "k" },
    });

    await llm.generateObject(schema, SYSTEM, INPUT, undefined, onResult);

    expect(onResult).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
      }),
    );
  });

  it("reports trace identifiers (messageId + request-id) from the response", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: { ok: true },
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      response: { id: "msg_trace123", headers: { "request-id": "req_xyz789" } },
    });
    const onResult = vi.fn();
    const llm = new VercelAILLMProvider({
      primary: { provider: "anthropic", apiKey: "k" },
    });

    await llm.generateObject(schema, SYSTEM, INPUT, undefined, onResult);

    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "msg_trace123",
        requestId: "req_xyz789",
        target: "anthropic:default",
      }),
    );
  });

  it("falls back to x-request-id when request-id header is absent", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: { ok: true },
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      response: { id: "msg_1", headers: { "x-request-id": "req_fallback" } },
    });
    const onResult = vi.fn();
    const llm = new VercelAILLMProvider({
      primary: { provider: "anthropic", apiKey: "k" },
    });

    await llm.generateObject(schema, SYSTEM, INPUT, undefined, onResult);

    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "req_fallback" }),
    );
  });

  it("reports the result exactly once — only for the attempt that succeeds", async () => {
    // Primary throws (no result), fallback succeeds and reports.
    generateObjectMock
      .mockRejectedValueOnce(new Error("primary down"))
      .mockResolvedValueOnce({
        object: { ok: true },
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        response: { id: "msg_fb", headers: { "request-id": "req_fb" } },
      });
    const onResult = vi.fn();
    const llm = new VercelAILLMProvider({
      primary: { provider: "anthropic", apiKey: "bad" },
      fallback: { provider: "gemini", apiKey: "good" },
    });

    await llm.generateObject(schema, SYSTEM, INPUT, undefined, onResult);

    expect(generateObjectMock).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        messageId: "msg_fb",
        requestId: "req_fb",
        target: "gemini:default",
      }),
    );
  });

  it("does not throw when the SDK omits usage/response and no onResult is given", async () => {
    generateObjectMock.mockResolvedValueOnce({ object: { ok: true } });
    const llm = new VercelAILLMProvider({
      primary: { provider: "anthropic", apiKey: "k" },
    });

    await expect(llm.generateObject(schema, SYSTEM, INPUT)).resolves.toEqual({ ok: true });
  });
});
