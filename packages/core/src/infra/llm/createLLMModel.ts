import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV1 } from "ai";
import type { LLMProviderName } from "../../contracts/IRunContext.js";

export type { LLMProviderName };

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Per-provider default model — used when no explicit model is configured. */
const DEFAULT_MODEL: Record<LLMProviderName, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  gemini: "gemini-2.0-flash",
  // Open-source model routed through OpenRouter's OpenAI-compatible API —
  // best structured-extraction accuracy among open-weight models at this size.
  openrouter: "qwen/qwen-2.5-72b-instruct",
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
    case "openrouter": {
      const openrouter = createOpenAICompatible({
        name: "openrouter",
        baseURL: OPENROUTER_BASE_URL,
        apiKey: opts.apiKey,
      });
      return openrouter(model);
    }
    default: {
      // Exhaustiveness guard — a new LLMProviderName without a branch fails the build.
      const _exhaustive: never = opts.provider;
      throw new Error(`Unsupported LLM provider: ${String(_exhaustive)}`);
    }
  }
}
