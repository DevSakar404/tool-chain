import type { IGmailCapability } from "../../contracts/IRunContext.js";
import type { BlobHandle } from "../../contracts/dtos.js";
import { ChainError } from "../../errors/index.js";
import { GoogleApiCapability } from "../google/GoogleApiCapability.js";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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

export class GmailCapability extends GoogleApiCapability implements IGmailCapability {
  protected readonly apiErrorCode = "GMAIL_API_ERROR";

  async fetchAttachment(messageId: string): Promise<BlobHandle> {
    // 1. Fetch the full message and walk its parts for a resume-like attachment.
    const message = await this.withRetry<GmailMessage>(() =>
      this.fetchJson<GmailMessage>(`${GMAIL_API}/messages/${messageId}?format=full`),
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
      this.fetchJson<GmailAttachmentBody>(
        `${GMAIL_API}/messages/${messageId}/attachments/${part.body!.attachmentId}`,
      ),
    );

    // Gmail returns base64url, not standard base64 — decode accordingly.
    const buffer = Buffer.from(attachment.data, "base64url");
    return this.store(messageId, buffer, effectiveMime(part));
  }
}
