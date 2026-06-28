import "server-only";
import { createClient } from "@supabase/supabase-js";
import { buildEngine } from "@tool-chain/core";
import type { EngineBundle } from "@tool-chain/core";

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
      ...(process.env["LLM_MODEL"] !== undefined ? { llmModel: process.env["LLM_MODEL"] } : {}),
      ...(process.env["STORAGE_BUCKET"] !== undefined
        ? { storageBucket: process.env["STORAGE_BUCKET"] }
        : {}),
    });
  }
  return bundle;
}
