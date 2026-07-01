import type { IDriveCapability } from "../../contracts/IRunContext.js";
import type { BlobHandle } from "../../contracts/dtos.js";
import { ChainError } from "../../errors/index.js";
import { GoogleApiCapability } from "../google/GoogleApiCapability.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3";

const GOOGLE_DOCS_MIME = "application/vnd.google-apps.document";
const GOOGLE_SHEETS_MIME = "application/vnd.google-apps.spreadsheet";
const EXPORT_MIME_MAP: Record<string, string> = {
  [GOOGLE_DOCS_MIME]: "text/plain",
  [GOOGLE_SHEETS_MIME]: "text/csv",
};

interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

export class GoogleDriveCapability extends GoogleApiCapability implements IDriveCapability {
  protected readonly apiErrorCode = "DRIVE_API_ERROR";

  async download(fileId: string): Promise<BlobHandle> {
    // 1. Get file metadata
    const meta = await this.withRetry<DriveFileMeta>(() =>
      this.fetchJson<DriveFileMeta>(
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
        this.fetchBuffer(
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
        this.fetchBuffer(`${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`),
      );
    }

    return this.store(fileId, buffer, effectiveMime);
  }
}
