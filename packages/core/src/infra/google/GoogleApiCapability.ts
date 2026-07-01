import { createHash } from "crypto";
import type { IStorage } from "../../contracts/IRunContext.js";
import type { BlobHandle } from "../../contracts/dtos.js";
import { ChainError } from "../../errors/index.js";

export const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface GoogleApiCapabilityOptions {
  accessToken: string;
  storage: IStorage;
  maxSizeBytes?: number | undefined;
}

/**
 * Shared base for Google API capabilities (Drive, Gmail): bearer-auth fetch with
 * retry, size enforcement, and the store-buffer → BlobHandle tail. Subclasses add
 * only their provider-specific request/parse logic.
 */
export abstract class GoogleApiCapability {
  protected readonly maxSizeBytes: number;
  /** Error code used in ChainError for this provider's HTTP failures. */
  protected abstract readonly apiErrorCode: string;

  constructor(protected readonly opts: GoogleApiCapabilityOptions) {
    this.maxSizeBytes = opts.maxSizeBytes ?? MAX_SIZE_BYTES;
  }

  protected async fetchJson<T>(url: string): Promise<T> {
    return this.fetchOk(url).then((res) => res.json() as Promise<T>);
  }

  protected async fetchBuffer(url: string): Promise<Buffer> {
    return this.fetchOk(url).then(async (res) => Buffer.from(await res.arrayBuffer()));
  }

  private async fetchOk(url: string): Promise<Response> {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.opts.accessToken}` },
    });
    if (!res.ok) {
      throw new ChainError(`Google API error ${res.status}: ${await res.text()}`, this.apiErrorCode);
    }
    return res;
  }

  protected async withRetry<T>(fn: () => Promise<T>): Promise<T> {
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

  /** Enforce the size limit, hash, upload, and return the handle. */
  protected async store(key: string, buffer: Buffer, mime: string): Promise<BlobHandle> {
    if (buffer.length > this.maxSizeBytes) {
      throw new ChainError(
        `Downloaded content ${buffer.length} bytes exceeds limit ${this.maxSizeBytes}`,
        "FILE_TOO_LARGE",
      );
    }
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const storageRef = await this.opts.storage.upload(`${key}-${sha256.slice(0, 8)}`, buffer, mime);
    return { storageRef, mime, size: buffer.length, sha256 };
  }
}
