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
// LLM provider selection — a node's preferred model is a declared property
// (today in code; a "preferred LLM" column in the tool registry later).
// ---------------------------------------------------------------------------
export type LLMProviderName = "anthropic" | "gemini";

export interface LLMTarget {
  provider: LLMProviderName;
  /** Optional model override; provider default is used when omitted. */
  model?: string | undefined;
}

// ---------------------------------------------------------------------------
// ILLMProvider — provider-agnostic; concrete impl uses Vercel AI SDK
// ---------------------------------------------------------------------------
export interface ILLMProvider {
  /**
   * Generate a schema-validated object.
   *
   * @param prefer Optional per-node provider preference. When set, this target
   *   is attempted first; on failure the call still falls through to the
   *   globally-configured primary → fallback chain (resilience preserved).
   */
  generateObject<T>(
    schema: ZodType<T>,
    systemPrompt: string,
    userInput: unknown,
    prefer?: LLMTarget,
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
