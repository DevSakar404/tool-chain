import { createHash } from "crypto";
import type { IGmailCapability, IStorage } from "../../contracts/IRunContext.js";
import type { BlobHandle } from "../../contracts/dtos.js";
import { ChainError } from "../../errors/index.js";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Gmail message payload shapes (only the fields we read)
// ---------------------------------------------------------------------------
interface GmailMessagePart {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; size?: number };
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  id: string;
  payload?: GmailMessagePart;
}

interface GmailAttachmentBody {
  size: number;
  data: string; // base64url
}

/** A resume-like part: PDF/DOCX by mime, or by filename extension as fallback. */
function isResumeLike(part: GmailMessagePart): boolean {
  const mime = part.mimeType ?? "";
  if (mime === PDF_MIME || mime === DOCX_MIME) return true;
  const name = (part.filename ?? "").toLowerCase();
  return name.endsWith(".pdf") || name.endsWith(".docx");
}

/** Depth-first walk; returns the first resume-like part that has an attachmentId. */
function findResumePart(part: GmailMessagePart | undefined): GmailMessagePart | undefined {
  if (!part) return undefined;
  if (part.body?.attachmentId && isResumeLike(part)) return part;
  for (const child of part.parts ?? []) {
    const found = findResumePart(child);
    if (found) return found;
  }
  return undefined;
}

/** Derive a usable mime from a part, falling back to its filename extension. */
function effectiveMime(part: GmailMessagePart): string {
  const mime = part.mimeType ?? "";
  if (mime === PDF_MIME || mime === DOCX_MIME) return mime;
  const name = (part.filename ?? "").toLowerCase();
  if (name.endsWith(".pdf")) return PDF_MIME;
  if (name.endsWith(".docx")) return DOCX_MIME;
  return mime || "application/octet-stream";
}

export interface GmailCapabilityOptions {
  accessToken: string;
  storage: IStorage;
  storageBucket?: string | undefined;
  maxSizeBytes?: number | undefined;
}

export class GmailCapability implements IGmailCapability {
  private readonly maxSizeBytes: number;
  private readonly storageBucket: string;

  constructor(private readonly opts: GmailCapabilityOptions) {
    this.maxSizeBytes = opts.maxSizeBytes ?? MAX_SIZE_BYTES;
    this.storageBucket = opts.storageBucket ?? "pipeline-blobs";
  }

  async fetchAttachment(messageId: string): Promise<BlobHandle> {
    // 1. Fetch the full message and walk its parts for a resume-like attachment.
    const message = await this.withRetry<GmailMessage>(() =>
      this.gmailJson<GmailMessage>(`${GMAIL_API}/messages/${messageId}?format=full`),
    );

    const part = findResumePart(message.payload);
    if (!part || !part.body?.attachmentId) {
      throw new ChainError(
        `No resume-like (PDF/DOCX) attachment found on message ${messageId}`,
        "NO_RESUME_ATTACHMENT",
      );
    }

    // Cheap pre-check against the size advertised in the part metadata.
    if (part.body.size && part.body.size > this.maxSizeBytes) {
      throw new ChainError(
        `Attachment size ${part.body.size} exceeds limit ${this.maxSizeBytes}`,
        "FILE_TOO_LARGE",
      );
    }

    // 2. Fetch the attachment body (base64url-encoded).
    const attachment = await this.withRetry<GmailAttachmentBody>(() =>
      this.gmailJson<GmailAttachmentBody>(
        `${GMAIL_API}/messages/${messageId}/attachments/${part.body!.attachmentId}`,
      ),
    );

    // Gmail returns base64url, not standard base64 — decode accordingly.
    const buffer = Buffer.from(attachment.data, "base64url");
    if (buffer.length > this.maxSizeBytes) {
      throw new ChainError(
        `Downloaded attachment ${buffer.length} bytes exceeds limit ${this.maxSizeBytes}`,
        "FILE_TOO_LARGE",
      );
    }

    const mime = effectiveMime(part);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const storageKey = `${messageId}-${sha256.slice(0, 8)}`;
    const storageRef = await this.opts.storage.upload(storageKey, buffer, mime);

    return { storageRef, mime, size: buffer.length, sha256 };
  }

  private async gmailJson<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.opts.accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new ChainError(`Gmail API error ${res.status}: ${body}`, "GMAIL_API_ERROR");
    }
    return res.json() as Promise<T>;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < RETRY_ATTEMPTS; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        if (i < RETRY_ATTEMPTS - 1) await sleep(RETRY_BASE_MS * 2 ** i);
      }
    }
    throw lastErr;
  }
}
