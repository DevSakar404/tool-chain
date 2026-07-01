import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GmailCapability } from "../../infra/gmail/GmailCapability.js";
import { ChainError } from "../../errors/index.js";
import type { IStorage } from "../../contracts/IRunContext.js";

const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function makeStorage(): IStorage {
  return {
    upload: vi.fn(async (key: string) => `pipeline-blobs/${key}`),
    download: vi.fn(),
    delete: vi.fn(),
  };
}

/** Encode a UTF-8 string as base64url, the way Gmail returns attachment data. */
function b64url(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64url");
}

/** Build a fetch mock that returns `message` for the message URL and `attachment`
 *  for the attachments URL. Either can be overridden to simulate errors. */
function mockFetch(opts: {
  message?: unknown;
  messageStatus?: number;
  attachment?: unknown;
  attachmentStatus?: number;
}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const isAttachment = url.includes("/attachments/");
      if (isAttachment) {
        const status = opts.attachmentStatus ?? 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => opts.attachment,
          text: async () => "attachment error body",
        };
      }
      const status = opts.messageStatus ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => opts.message,
        text: async () => "message error body",
      };
    }),
  );
}

describe("GmailCapability.fetchAttachment", () => {
  let storage: IStorage;

  beforeEach(() => {
    storage = makeStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("picks the first PDF/DOCX part, skipping inline/non-document parts", async () => {
    mockFetch({
      message: {
        id: "m1",
        payload: {
          mimeType: "multipart/mixed",
          parts: [
            { mimeType: "text/html", body: { size: 10 } }, // body, no attachment
            { mimeType: "image/png", filename: "logo.png", body: { attachmentId: "att-img", size: 5 } },
            { mimeType: PDF_MIME, filename: "resume.pdf", body: { attachmentId: "att-pdf", size: 4 } },
          ],
        },
      },
      attachment: { size: 4, data: b64url("PDF!") },
    });

    const cap = new GmailCapability({ accessToken: "tok", storage });
    const handle = await cap.fetchAttachment("m1");

    // The attachments URL must reference the PDF's attachmentId, not the image's.
    const calls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/attachments/att-pdf"))).toBe(true);
    expect(calls.some((u) => u.includes("/attachments/att-img"))).toBe(false);

    expect(handle.mime).toBe(PDF_MIME);
    expect(handle.size).toBe(4);
    expect(storage.upload).toHaveBeenCalledTimes(1);
  });

  it("recurses into nested multipart parts to find the attachment", async () => {
    mockFetch({
      message: {
        id: "m2",
        payload: {
          mimeType: "multipart/mixed",
          parts: [
            {
              mimeType: "multipart/alternative",
              parts: [
                { mimeType: "text/plain", body: { size: 3 } },
                { mimeType: DOCX_MIME, filename: "cv.docx", body: { attachmentId: "att-docx", size: 6 } },
              ],
            },
          ],
        },
      },
      attachment: { size: 6, data: b64url("DOCXX!") },
    });

    const cap = new GmailCapability({ accessToken: "tok", storage });
    const handle = await cap.fetchAttachment("m2");
    expect(handle.mime).toBe(DOCX_MIME);
  });

  it("decodes base64url attachment data and computes a stable handle", async () => {
    const content = "Hello résumé — base64url ✓";
    mockFetch({
      message: {
        id: "m3",
        payload: { parts: [{ mimeType: PDF_MIME, filename: "r.pdf", body: { attachmentId: "a", size: 99 } }] },
      },
      attachment: { size: 99, data: b64url(content) },
    });

    const cap = new GmailCapability({ accessToken: "tok", storage });
    const handle = await cap.fetchAttachment("m3");

    const expectedBuf = Buffer.from(content, "utf-8");
    expect(handle.size).toBe(expectedBuf.length);
    // upload received the decoded bytes
    const uploadArg = vi.mocked(storage.upload).mock.calls[0]![1] as Buffer;
    expect(uploadArg.equals(expectedBuf)).toBe(true);
  });

  it("falls back to filename extension when mimeType is absent", async () => {
    mockFetch({
      message: {
        id: "m4",
        payload: { parts: [{ filename: "resume.PDF", body: { attachmentId: "a", size: 4 } }] },
      },
      attachment: { size: 4, data: b64url("data") },
    });

    const cap = new GmailCapability({ accessToken: "tok", storage });
    const handle = await cap.fetchAttachment("m4");
    expect(handle.mime).toBe(PDF_MIME);
  });

  it("throws NO_RESUME_ATTACHMENT when no PDF/DOCX part exists", async () => {
    mockFetch({
      message: {
        id: "m5",
        payload: {
          parts: [
            { mimeType: "text/plain", body: { size: 3 } },
            { mimeType: "image/png", filename: "pic.png", body: { attachmentId: "i", size: 5 } },
          ],
        },
      },
    });

    const cap = new GmailCapability({ accessToken: "tok", storage });
    await expect(cap.fetchAttachment("m5")).rejects.toMatchObject({
      code: "NO_RESUME_ATTACHMENT",
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("throws FILE_TOO_LARGE when the part metadata size exceeds the limit", async () => {
    mockFetch({
      message: {
        id: "m6",
        payload: { parts: [{ mimeType: PDF_MIME, filename: "big.pdf", body: { attachmentId: "a", size: 999 } }] },
      },
    });

    const cap = new GmailCapability({ accessToken: "tok", storage, maxSizeBytes: 100 });
    await expect(cap.fetchAttachment("m6")).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
  });

  it("throws GMAIL_API_ERROR on a non-2xx message response", async () => {
    mockFetch({ message: {}, messageStatus: 404 });
    const cap = new GmailCapability({ accessToken: "tok", storage });
    const err = await cap.fetchAttachment("m7").catch((e) => e);
    expect(err).toBeInstanceOf(ChainError);
    expect((err as ChainError).code).toBe("GMAIL_API_ERROR");
  });
});
