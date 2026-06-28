import { createHash } from "crypto";
import type { IDriveCapability } from "../../contracts/IRunContext.js";
import type { BlobHandle } from "../../contracts/dtos.js";
import type { IStorage } from "../../contracts/IRunContext.js";
import { ChainError } from "../../errors/index.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3";

const GOOGLE_DOCS_MIME = "application/vnd.google-apps.document";
const GOOGLE_SHEETS_MIME = "application/vnd.google-apps.spreadsheet";
const EXPORT_MIME_MAP: Record<string, string> = {
  [GOOGLE_DOCS_MIME]: "text/plain",
  [GOOGLE_SHEETS_MIME]: "text/csv",
};

const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

export interface GoogleDriveCapabilityOptions {
  accessToken: string;
  storage: IStorage;
  storageBucket?: string | undefined;
  maxSizeBytes?: number | undefined;
}

export class GoogleDriveCapability implements IDriveCapability {
  private readonly maxSizeBytes: number;
  private readonly storageBucket: string;

  constructor(private readonly opts: GoogleDriveCapabilityOptions) {
    this.maxSizeBytes = opts.maxSizeBytes ?? MAX_SIZE_BYTES;
    this.storageBucket = opts.storageBucket ?? "pipeline-blobs";
  }

  async download(fileId: string): Promise<BlobHandle> {
    // 1. Get file metadata
    const meta = await this.withRetry<DriveFileMeta>(() =>
      this.driveJson<DriveFileMeta>(
        `${DRIVE_API}/files/${fileId}?fields=id,name,mimeType,size&supportsAllDrives=true`,
      ),
    );

    const exportMime = EXPORT_MIME_MAP[meta.mimeType];
    let buffer: Buffer;
    let effectiveMime: string;

    if (exportMime) {
      // Google Workspace doc — export as plain text
      effectiveMime = exportMime;
      buffer = await this.withRetry<Buffer>(() =>
        this.driveBuffer(
          `${DRIVE_API}/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`,
        ),
      );
    } else {
      // Binary file — download media
      effectiveMime = meta.mimeType ?? "application/octet-stream";
      if (meta.size && parseInt(meta.size) > this.maxSizeBytes) {
        throw new ChainError(
          `File size ${meta.size} exceeds limit ${this.maxSizeBytes}`,
          "FILE_TOO_LARGE",
        );
      }
      buffer = await this.withRetry<Buffer>(() =>
        this.driveBuffer(
          `${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`,
        ),
      );
    }

    if (buffer.length > this.maxSizeBytes) {
      throw new ChainError(
        `Downloaded content ${buffer.length} bytes exceeds limit ${this.maxSizeBytes}`,
        "FILE_TOO_LARGE",
      );
    }

    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const storageKey = `${fileId}-${sha256.slice(0, 8)}`;
    const storageRef = await this.opts.storage.upload(storageKey, buffer, effectiveMime);

    return { storageRef, mime: effectiveMime, size: buffer.length, sha256 };
  }

  private async driveJson<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.opts.accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new ChainError(`Drive API error ${res.status}: ${body}`, "DRIVE_API_ERROR");
    }
    return res.json() as Promise<T>;
  }

  private async driveBuffer(url: string): Promise<Buffer> {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.opts.accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new ChainError(`Drive API error ${res.status}: ${body}`, "DRIVE_API_ERROR");
    }
    return Buffer.from(await res.arrayBuffer());
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
