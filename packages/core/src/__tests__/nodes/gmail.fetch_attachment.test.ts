import { describe, it, expect, vi } from "vitest";
import { gmailFetchAttachmentNode } from "../../nodes/tools/gmail.fetch_attachment.js";
import type { IRunContext } from "../../contracts/IRunContext.js";
import type { BlobHandle } from "../../contracts/dtos.js";
import { UsageAccumulator } from "../../engine/UsageAccumulator.js";
import { iNodeConformanceSuite } from "../contract/INode.conformance.js";

const fakeBlobHandle: BlobHandle = {
  storageRef: "pipeline-blobs/resume.pdf",
  mime: "application/pdf",
  size: 2048,
  sha256: "deadbeef",
};

function makeCtx(blobHandle: BlobHandle = fakeBlobHandle): IRunContext {
  return {
    runId: "r1",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    drive: { download: vi.fn() },
    gmail: { fetchAttachment: vi.fn().mockResolvedValue(blobHandle) },
    llm: { generateObject: vi.fn() },
    storage: { upload: vi.fn(), download: vi.fn(), delete: vi.fn() },
    usage: new UsageAccumulator(),
  };
}

iNodeConformanceSuite(
  "gmail.fetch_attachment",
  () => gmailFetchAttachmentNode,
  { messageId: "msg-123" },
  { messageId: "" }, // empty string — fails min(1)
  makeCtx(),
);

describe("gmail.fetch_attachment behaviour", () => {
  it("delegates to ctx.gmail.fetchAttachment with the messageId", async () => {
    const ctx = makeCtx();
    await gmailFetchAttachmentNode.execute({ messageId: "abc-789" }, ctx);
    expect(ctx.gmail.fetchAttachment).toHaveBeenCalledWith("abc-789");
  });

  it("returns the BlobHandle from gmail.fetchAttachment", async () => {
    const ctx = makeCtx();
    const result = await gmailFetchAttachmentNode.execute({ messageId: "m1" }, ctx);
    expect(result).toEqual({ ok: true, output: fakeBlobHandle });
  });

  it("returns NodeError if gmail.fetchAttachment throws", async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.gmail.fetchAttachment).mockRejectedValue(
      new Error("No resume attachment"),
    );
    const result = await gmailFetchAttachmentNode.execute({ messageId: "m1" }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("NodeError");
      expect(result.error.message).toBe("No resume attachment");
    }
  });
});
