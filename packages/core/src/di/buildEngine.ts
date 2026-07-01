import { NodeRegistry } from "../registry/NodeRegistry.js";
import { ChainEngine } from "../engine/ChainEngine.js";
import { UsageAccumulator } from "../engine/UsageAccumulator.js";
import { LLMCallTrace } from "../engine/LLMCallTrace.js";
import { registerAll } from "../nodes/index.js";
import { GoogleDriveCapability } from "../infra/drive/GoogleDriveCapability.js";
import { GmailCapability } from "../infra/gmail/GmailCapability.js";
import { VercelAILLMProvider, type ResolvedTarget } from "../infra/llm/VercelAILLMProvider.js";
import type { LLMProviderName } from "../contracts/IRunContext.js";
import { SupabaseChainRepository } from "../infra/supabase/SupabaseChainRepository.js";
import { SupabaseRunRepository } from "../infra/supabase/SupabaseRunRepository.js";
import { SupabaseStorage } from "../infra/supabase/SupabaseStorage.js";
import { ConsoleLogger } from "../infra/logging/ConsoleLogger.js";
import type { IRunContext } from "../contracts/IRunContext.js";
import type { SafeError } from "../contracts/dtos.js";
import type { IChainRepository } from "../contracts/IRepositories.js";
import type { SupabaseDb, SupabaseClientLike } from "../infra/supabase/SupabaseTypes.js";

export interface BuildEngineOptions {
  /**
   * Pre-built Supabase client — created in apps/web to keep @supabase/supabase-js out of core.
   *
   * Typed as the structural minimum the adapters actually use (`SupabaseClientLike`)
   * rather than `SupabaseDb` directly: the real `SupabaseClient` from
   * @supabase/supabase-js is not structurally assignable to our hand-written
   * `SupabaseDb` (its `from()` returns a generic PostgrestQueryBuilder), but it
   * does satisfy the looser `SupabaseClientLike`. The single narrowing cast to
   * `SupabaseDb` happens here, at the composition root — the only place a boundary
   * cast belongs.
   */
  db: SupabaseClientLike;
  /** Google OAuth2 access token (ya29.xxx) — obtain from OAuth Playground or gcloud auth */
  googleAccessToken: string;
  /**
   * Gmail OAuth2 access token (ya29.xxx), scope `gmail.readonly`. Powers the
   * gmail.fetch_attachment node. Short-lived (~1h) — refresh as needed. May be
   * the same Google token as `googleAccessToken` if it carries both scopes.
   */
  gmailAccessToken: string;
  anthropicApiKey: string;
  /** Gemini API key — required only when gemini is the active or fallback provider. */
  geminiApiKey?: string | undefined;
  /** OpenRouter API key — required only when openrouter is the active or fallback provider. */
  openrouterApiKey?: string | undefined;
  /** Primary LLM provider. Defaults to "anthropic" to preserve existing behavior. */
  llmProvider?: LLMProviderName | undefined;
  /**
   * Optional fallback provider. When set, a failed primary LLM call is retried
   * once against this provider — the resilience path for bad keys / outages.
   */
  llmFallbackProvider?: LLMProviderName | undefined;
  llmModel?: string | undefined;
  /** Optional model override for the fallback provider. */
  llmFallbackModel?: string | undefined;
  storageBucket?: string | undefined;
}

export interface EngineBundle {
  engine: ChainEngine;
  registry: NodeRegistry;
  chainRepository: IChainRepository;
}

/**
 * Composition root — manually wires all adapters.
 * Call once at app startup; reuse the returned bundle.
 * The caller is responsible for creating the Supabase client.
 */
export function buildEngine(opts: BuildEngineOptions): EngineBundle {
  // Single boundary cast: the real SupabaseClient satisfies SupabaseClientLike but
  // is not directly assignable to our internal SupabaseDb contract. Narrow once here.
  const db = opts.db as unknown as SupabaseDb;

  const storage = new SupabaseStorage(db, opts.storageBucket ?? "pipeline-blobs");
  const chainRepo = new SupabaseChainRepository(db);
  const runRepo = new SupabaseRunRepository(db);

  const drive = new GoogleDriveCapability({
    accessToken: opts.googleAccessToken,
    storage,
  });

  const gmail = new GmailCapability({
    accessToken: opts.gmailAccessToken,
    storage,
  });

  // Resolve a provider name to a credentialed LLM target. Throws early at the
  // composition root if a selected provider has no key — clearer than a runtime
  // "invalid x-api-key" deep inside a node.
  const ENV_VAR_FOR: Record<LLMProviderName, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GEMINI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  };
  const apiKeyFor = (provider: LLMProviderName): string => {
    const key =
      provider === "gemini"
        ? (opts.geminiApiKey ?? "")
        : provider === "openrouter"
          ? (opts.openrouterApiKey ?? "")
          : opts.anthropicApiKey;
    if (!key) {
      throw new Error(
        `LLM provider "${provider}" selected but its API key is missing. Set ${ENV_VAR_FOR[provider]}.`,
      );
    }
    return key;
  };

  const primaryProvider: LLMProviderName = opts.llmProvider ?? "anthropic";
  const primaryTarget: ResolvedTarget = {
    provider: primaryProvider,
    apiKey: apiKeyFor(primaryProvider),
    ...(opts.llmModel !== undefined ? { model: opts.llmModel } : {}),
  };

  let fallbackTarget: ResolvedTarget | undefined;
  if (opts.llmFallbackProvider && opts.llmFallbackProvider !== primaryProvider) {
    fallbackTarget = {
      provider: opts.llmFallbackProvider,
      apiKey: apiKeyFor(opts.llmFallbackProvider),
      ...(opts.llmFallbackModel !== undefined ? { model: opts.llmFallbackModel } : {}),
    };
  }

  // Per-provider keys so a node's preferred LLM resolves even when that provider
  // is neither primary nor fallback (e.g. resume.parse_fields prefers gemini).
  // Only non-empty keys are included — a missing key means that provider simply
  // isn't available as a preference, and the call falls through to the chain.
  const apiKeys: Partial<Record<LLMProviderName, string>> = {};
  if (opts.anthropicApiKey) apiKeys.anthropic = opts.anthropicApiKey;
  if (opts.geminiApiKey) apiKeys.gemini = opts.geminiApiKey;
  if (opts.openrouterApiKey) apiKeys.openrouter = opts.openrouterApiKey;

  const llm = new VercelAILLMProvider({
    primary: primaryTarget,
    apiKeys,
    logger: new ConsoleLogger("llm"),
    ...(fallbackTarget !== undefined ? { fallback: fallbackTarget } : {}),
  });

  const registry = new NodeRegistry();
  registerAll(registry);

  const ctxFactory = (runId: string): IRunContext => ({
    runId,
    logger: new ConsoleLogger(runId),
    drive,
    gmail,
    llm,
    storage,
    usage: new UsageAccumulator(),
    llmTrace: new LLMCallTrace(),
  });

  const engine = new ChainEngine({ registry, chainRepo, runRepo, ctxFactory });

  return { engine, registry, chainRepository: chainRepo };
}

/**
 * D8 redaction boundary — call before persisting any thrown value.
 * Only name, message, code survive.
 */
export function toSafeError(e: unknown): SafeError {
  if (e instanceof Error) {
    const code = (e as Error & { code?: string }).code;
    const safe: SafeError = { name: e.name, message: e.message };
    if (code !== undefined) safe.code = code;
    return safe;
  }
  return { name: "UnknownError", message: String(e) };
}
