import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModelV1 } from "ai";
import type { LLMProviderName } from "../../contracts/IRunContext.js";

export type { LLMProviderName };

/** Per-provider default model — used when no explicit model is configured. */
const DEFAULT_MODEL: Record<LLMProviderName, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  gemini: "gemini-2.0-flash",
};

export interface CreateLLMModelOptions {
  provider: LLMProviderName;
  apiKey: string;
  /** Optional model override; falls back to the provider default. */
  model?: string | undefined;
}

/**
 * Maps a provider name + credentials to a Vercel AI SDK language model.
 * The single place that knows about concrete provider SDKs — adding a new
 * provider means one more branch here, nothing else in the engine changes.
 */
export function createLLMModel(opts: CreateLLMModelOptions): LanguageModelV1 {
  const model = opts.model ?? DEFAULT_MODEL[opts.provider];
  switch (opts.provider) {
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey: opts.apiKey });
      return anthropic(model);
    }
    case "gemini": {
      const google = createGoogleGenerativeAI({ apiKey: opts.apiKey });
      return google(model);
    }
    default: {
      // Exhaustiveness guard — a new LLMProviderName without a branch fails the build.
      const _exhaustive: never = opts.provider;
      throw new Error(`Unsupported LLM provider: ${String(_exhaustive)}`);
    }
  }
}
