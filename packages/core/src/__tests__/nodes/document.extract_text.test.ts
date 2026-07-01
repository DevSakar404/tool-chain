import { describe, it, expect, vi } from "vitest";
import { documentExtractTextNode } from "../../nodes/tools/document.extract_text.js";
import type { IRunContext } from "../../contracts/IRunContext.js";
import type { BlobHandle } from "../../contracts/dtos.js";
import { UsageAccumulator } from "../../engine/UsageAccumulator.js";
import { iNodeConformanceSuite } from "../contract/INode.conformance.js";

const LONG_TEXT = "a".repeat(200);

function makeBlob(mime: string, text: string): { blob: BlobHandle; ctx: IRunContext } {
  const buf = Buffer.from(text, "utf-8");
  const blob: BlobHandle = { storageRef: "pipeline-blobs/test", mime, size: buf.length, sha256: "abc" };
  const ctx: IRunContext = {
    runId: "r1",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    drive: { download: vi.fn() },
    gmail: { fetchAttachment: vi.fn() },
    llm: { generateObject: vi.fn() },
    storage: { upload: vi.fn(), download: vi.fn().mockResolvedValue(buf), delete: vi.fn() },
    usage: new UsageAccumulator(),
  };
  return { blob, ctx };
}

// Minimal valid blob for conformance suite
const { blob: conformanceBlob, ctx: conformanceCtx } = makeBlob("text/plain", LONG_TEXT);

iNodeConformanceSuite(
  "document.extract_text",
  () => documentExtractTextNode,
  conformanceBlob,
  { bad: "input" }, // missing required fields
  conformanceCtx,
);

describe("document.extract_text behaviour", () => {
  it("extracts text from plain text mime", async () => {
    const { blob, ctx } = makeBlob("text/plain", LONG_TEXT);
    const result = await documentExtractTextNode.execute(blob, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output.text).toBe(LONG_TEXT);
  });

  it("returns NodeError for unsupported mime", async () => {
    const { blob, ctx } = makeBlob("image/png", LONG_TEXT);
    const result = await documentExtractTextNode.execute(blob, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("NodeError");
      expect(result.error.code).toBe("UNSUPPORTED_MIME");
    }
  });

  it("returns NodeError when text is below min-content threshold", async () => {
    const { blob, ctx } = makeBlob("text/plain", "too short");
    const result = await documentExtractTextNode.execute(blob, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("NodeError");
      expect(result.error.code).toBe("NO_EXTRACTABLE_TEXT");
    }
  });

  it("returns NodeError when storage.download throws", async () => {
    const { blob, ctx } = makeBlob("text/plain", LONG_TEXT);
    vi.mocked(ctx.storage.download).mockRejectedValue(new Error("Storage failure"));
    const result = await documentExtractTextNode.execute(blob, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("NodeError");
  });
});
