import { describe, it, expect, vi } from "vitest";
import { driveDownloadFileNode } from "../../nodes/tools/drive.download_file.js";
import type { IRunContext } from "../../contracts/IRunContext.js";
import type { BlobHandle } from "../../contracts/dtos.js";
import { UsageAccumulator } from "../../engine/UsageAccumulator.js";
import { iNodeConformanceSuite } from "../contract/INode.conformance.js";

const fakeBlobHandle: BlobHandle = {
  storageRef: "pipeline-blobs/test.pdf",
  mime: "application/pdf",
  size: 1024,
  sha256: "abc123",
};

function makeCtx(blobHandle: BlobHandle = fakeBlobHandle): IRunContext {
  return {
    runId: "r1",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    drive: { download: vi.fn().mockResolvedValue(blobHandle) },
    gmail: { fetchAttachment: vi.fn() },
    llm: { generateObject: vi.fn() },
    storage: { upload: vi.fn(), download: vi.fn(), delete: vi.fn() },
    usage: new UsageAccumulator(),
  };
}

iNodeConformanceSuite(
  "drive.download_file",
  () => driveDownloadFileNode,
  { fileId: "file-123" },
  { fileId: "" }, // empty string — fails min(1)
  makeCtx(),
);

describe("drive.download_file behaviour", () => {
  it("delegates to ctx.drive.download with the fileId", async () => {
    const ctx = makeCtx();
    await driveDownloadFileNode.execute({ fileId: "xyz-789" }, ctx);
    expect(ctx.drive.download).toHaveBeenCalledWith("xyz-789");
  });

  it("returns BlobHandle from drive.download", async () => {
    const ctx = makeCtx();
    const result = await driveDownloadFileNode.execute({ fileId: "f1" }, ctx);
    expect(result).toEqual({ ok: true, output: fakeBlobHandle });
  });

  it("returns NodeError if drive.download throws", async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.drive.download).mockRejectedValue(new Error("Drive 404"));
    const result = await driveDownloadFileNode.execute({ fileId: "f1" }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("NodeError");
      expect(result.error.message).toBe("Drive 404");
    }
  });
});
