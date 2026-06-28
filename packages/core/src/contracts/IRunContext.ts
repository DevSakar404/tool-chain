import type { ZodType } from "zod";
import type { BlobHandle } from "./dtos.js";

// ---------------------------------------------------------------------------
// ILogger
// ---------------------------------------------------------------------------
export interface ILogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// IDriveCapability — capability handle; never exposes raw credentials (D7)
// ---------------------------------------------------------------------------
export interface IDriveCapability {
  /**
   * Download or export a Drive file to Storage.
   * Returns a BlobHandle; never returns raw bytes to the engine.
   */
  download(fileId: string): Promise<BlobHandle>;
}

// ---------------------------------------------------------------------------
// ILLMProvider — provider-agnostic; concrete impl uses Vercel AI SDK
// ---------------------------------------------------------------------------
export interface ILLMProvider {
  generateObject<T>(
    schema: ZodType<T>,
    systemPrompt: string,
    userInput: unknown,
  ): Promise<T>;
}

// ---------------------------------------------------------------------------
// IStorage — blob storage abstraction
// ---------------------------------------------------------------------------
export interface IStorage {
  upload(key: string, data: Buffer, mime: string): Promise<string>; // returns storageRef
  download(storageRef: string): Promise<Buffer>;
  delete(storageRef: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// IRunContext — injected into every node.execute(); no raw secrets (D7)
// ---------------------------------------------------------------------------
export interface IRunContext {
  readonly runId: string;
  readonly logger: ILogger;
  readonly drive: IDriveCapability;
  readonly llm: ILLMProvider;
  readonly storage: IStorage;
}
