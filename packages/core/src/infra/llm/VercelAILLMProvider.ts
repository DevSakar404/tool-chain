import { generateObject as aiGenerateObject, type LanguageModelV1 } from "ai";
import type { ZodType } from "zod";
import type {
  ILLMProvider,
  ILogger,
  LLMCallResult,
  LLMProviderName,
  LLMTarget,
} from "../../contracts/IRunContext.js";
import { createLLMModel } from "./createLLMModel.js";

export type { LLMTarget };

export interface ResolvedTarget {
  provider: LLMProviderName;
  apiKey: string;
  model?: string | undefined;
}

export interface VercelAILLMProviderOptions {
  /** Primary target — the global default tried when a node has no preference. */
  primary: ResolvedTarget;
  /**
   * Optional global fallback. A failed call (after the primary, and after any
   * per-node preference) is retried once here — the resilience path.
   */
  fallback?: ResolvedTarget | undefined;
  /**
   * Per-provider API keys, so a per-node preferred provider can be constructed
   * on demand even if it isn't the primary/fallback. Missing keys mean that
   * provider can't be used as a preference and the call falls through.
   */
  apiKeys?: Partial<Record<LLMProviderName, string>> | undefined;
  /** Optional logger to record fallback switches; no-op if omitted. */
  logger?: ILogger | undefined;
}

interface Attempt {
  label: string;
  model: LanguageModelV1;
}

export class VercelAILLMProvider implements ILLMProvider {
  private readonly primary: LanguageModelV1;
  private readonly primaryName: LLMProviderName;
  private readonly fallback: LanguageModelV1 | undefined;
  private readonly fallbackName: LLMProviderName | undefined;
  private readonly apiKeys: Partial<Record<LLMProviderName, string>>;
  private readonly logger: ILogger | undefined;

  constructor(opts: VercelAILLMProviderOptions) {
    this.primary = createLLMModel(opts.primary);
    this.primaryName = opts.primary.provider;
    this.logger = opts.logger;

    // Seed the key map from primary/fallback, then layer any explicit keys on top.
    this.apiKeys = { [opts.primary.provider]: opts.primary.apiKey, ...(opts.apiKeys ?? {}) };

    if (opts.fallback) {
      this.fallback = createLLMModel(opts.fallback);
      this.fallbackName = opts.fallback.provider;
      this.apiKeys[opts.fallback.provider] ??= opts.fallback.apiKey;
    } else {
      this.fallback = undefined;
      this.fallbackName = undefined;
    }
  }

  async generateObject<T>(
    schema: ZodType<T>,
    systemPrompt: string,
    userInput: unknown,
    prefer?: LLMTarget,
    onResult?: (result: LLMCallResult) => void,
  ): Promise<T> {
    const prompt = JSON.stringify(userInput);

    // Ordered attempt chain: node preference → global primary → global fallback.
    // De-duplicated so we never retry the identical (provider, model) target.
    const attempts: Attempt[] = [];
    const seen = new Set<string>();
    const push = (model: LanguageModelV1 | undefined, provider: LLMProviderName, m?: string): void => {
      if (!model) return;
      const key = `${provider}:${m ?? "default"}`;
      if (seen.has(key)) return;
      seen.add(key);
      attempts.push({ label: key, model });
    };

    if (prefer) {
      const key = this.apiKeys[prefer.provider];
      if (key) {
        push(createLLMModel({ provider: prefer.provider, apiKey: key, model: prefer.model }), prefer.provider, prefer.model);
      } else {
        this.logger?.warn("Node preferred LLM has no API key; using global chain", {
          preferred: prefer.provider,
        });
      }
    }
    push(this.primary, this.primaryName);
    push(this.fallback, this.fallbackName as LLMProviderName, undefined);

    let lastErr: unknown;
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i]!;
      try {
        const { object, usage, response } = await aiGenerateObject({
          model: attempt.model,
          schema,
          system: systemPrompt,
          prompt,
        });
        // Report usage + trace identifiers only for the single successful
        // attempt — failed fallbacks above already threw, so this fires
        // exactly once. `response.id` is the provider message id (Anthropic
        // `msg_…`); the `request-id` response header is what Anthropic support
        // and the console index requests by.
        if (onResult) {
          const headers = response?.headers;
          onResult({
            usage: {
              promptTokens: usage?.promptTokens ?? Number.NaN,
              completionTokens: usage?.completionTokens ?? Number.NaN,
              totalTokens: usage?.totalTokens ?? Number.NaN,
            },
            messageId: response?.id,
            requestId: headers?.["request-id"] ?? headers?.["x-request-id"],
            target: attempt.label,
            fallbackUsed: i > 0,
          });
        }
        return object;
      } catch (err) {
        lastErr = err;
        const next = attempts[i + 1];
        if (next) {
          const reason = err instanceof Error ? err.message : String(err);
          this.logger?.warn("LLM attempt failed; trying next target", {
            failed: attempt.label,
            next: next.label,
            reason,
          });
        }
      }
    }
    throw lastErr;
  }
}
