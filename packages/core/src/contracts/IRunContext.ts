import type { ZodType } from "zod";
import type { z } from "zod";
import type { BlobHandle, LLMProviderNameSchema } from "./dtos.js";

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
// IGmailCapability — capability handle; never exposes raw credentials (D7)
// ---------------------------------------------------------------------------
export interface IGmailCapability {
  /**
   * Fetch the first resume-like (PDF/DOCX) attachment from a Gmail message and
   * store it in Storage. Returns a BlobHandle; never returns raw bytes to the
   * engine. Auth (the access token) is hidden inside the adapter.
   */
  fetchAttachment(messageId: string): Promise<BlobHandle>;
}

// ---------------------------------------------------------------------------
// LLM provider selection — a node's preferred model is a declared property
// (today in code; a "preferred LLM" column in the tool registry later).
// ---------------------------------------------------------------------------
export type LLMProviderName = z.infer<typeof LLMProviderNameSchema>;

export interface LLMTarget {
  provider: LLMProviderName;
  /** Optional model override; provider default is used when omitted. */
  model?: string | undefined;
}

// ---------------------------------------------------------------------------
// Token usage — reported by LLM calls, accumulated per run
// ---------------------------------------------------------------------------
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ---------------------------------------------------------------------------
// LLMCallResult — what a single successful generateObject reports back:
// token usage plus provider trace identifiers so the call can be correlated
// to a specific Anthropic API request (the `messageId` is the `msg_…` id; the
// `requestId` is Anthropic's `request-id` response header). Either trace field
// may be undefined when the provider doesn't expose it (e.g. non-Anthropic).
// ---------------------------------------------------------------------------
export interface LLMCallResult {
  usage: TokenUsage;
  /** Provider-assigned response id, e.g. Anthropic `msg_…`. */
  messageId?: string | undefined;
  /** Anthropic `request-id` response header, for support/console correlation. */
  requestId?: string | undefined;
  /** Resolved provider:model label that actually served the call. */
  target?: string | undefined;
  /** True when a non-first attempt in the prefer→primary→fallback chain served the call. */
  fallbackUsed: boolean;
}

/**
 * Run-scoped accumulator for LLM token usage. One instance per run lives on the
 * IRunContext; the LLM provider reports each successful call's usage via the
 * `onUsage` callback, and the engine reads `total()` when the run ends.
 */
export interface IUsageSink {
  add(usage: TokenUsage): void;
  /** Sum of `totalTokens` across all `add()` calls; 0 if none. */
  total(): number;
}

/**
 * Per-step LLM call trace, mirrored onto the step-run for UI/log visibility.
 * A skill node's `onResult` callback writes it; the engine reads and clears it
 * immediately after `node.execute` returns, so it never leaks into the next step.
 */
export interface ILLMCallTraceSink {
  set(target: string, fallbackUsed: boolean): void;
  /** Reads and clears the last-recorded trace; undefined if the step made no LLM call. */
  takeLast(): { target: string; fallbackUsed: boolean } | undefined;
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
   * @param onResult Optional callback invoked once, with the result of the
   *   single successful attempt (never from a failed attempt that falls
   *   through). Carries token usage plus provider trace identifiers so the
   *   caller can both account for tokens and correlate the call to a specific
   *   Anthropic API request.
   */
  generateObject<T>(
    schema: ZodType<T>,
    systemPrompt: string,
    userInput: unknown,
    prefer?: LLMTarget,
    onResult?: (result: LLMCallResult) => void,
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
  readonly gmail: IGmailCapability;
  readonly llm: ILLMProvider;
  readonly storage: IStorage;
  /** Run-scoped LLM token-usage accumulator. */
  readonly usage: IUsageSink;
  /** Last LLM call's target + fallback trace, for the current step. */
  readonly llmTrace: ILLMCallTraceSink;
}
