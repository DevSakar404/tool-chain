import "server-only";
import { createClient } from "@supabase/supabase-js";
import { buildEngine } from "@tool-chain/core";
import type { EngineBundle, LLMProviderName } from "@tool-chain/core";

let bundle: EngineBundle | null = null;

export function getEngineBundle(): EngineBundle {
  if (!bundle) {
    const supabaseUrl = process.env["SUPABASE_URL"] ?? "";
    const supabaseKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
    const db = createClient(supabaseUrl, supabaseKey);

    bundle = buildEngine({
      db,
      googleAccessToken: process.env["GOOGLE_ACCESS_TOKEN"] ?? "",
      anthropicApiKey: process.env["ANTHROPIC_API_KEY"] ?? "",
      geminiApiKey: process.env["GEMINI_API_KEY"] ?? "",
      ...(process.env["LLM_PROVIDER"] !== undefined
        ? { llmProvider: process.env["LLM_PROVIDER"] as LLMProviderName }
        : {}),
      ...(process.env["LLM_FALLBACK_PROVIDER"] !== undefined
        ? { llmFallbackProvider: process.env["LLM_FALLBACK_PROVIDER"] as LLMProviderName }
        : {}),
      ...(process.env["LLM_MODEL"] !== undefined ? { llmModel: process.env["LLM_MODEL"] } : {}),
      ...(process.env["LLM_FALLBACK_MODEL"] !== undefined
        ? { llmFallbackModel: process.env["LLM_FALLBACK_MODEL"] }
        : {}),
      ...(process.env["STORAGE_BUCKET"] !== undefined
        ? { storageBucket: process.env["STORAGE_BUCKET"] }
        : {}),
    });
  }
  return bundle;
}
