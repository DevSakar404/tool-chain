import { NodeRegistry } from "../registry/NodeRegistry.js";
import { ChainEngine } from "../engine/ChainEngine.js";
import { registerAll } from "../nodes/index.js";
import { GoogleDriveCapability } from "../infra/drive/GoogleDriveCapability.js";
import { VercelAILLMProvider } from "../infra/llm/VercelAILLMProvider.js";
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
  anthropicApiKey: string;
  llmModel?: string | undefined;
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

  const llm = new VercelAILLMProvider({
    apiKey: opts.anthropicApiKey,
    ...(opts.llmModel !== undefined ? { model: opts.llmModel } : {}),
  });

  const registry = new NodeRegistry();
  registerAll(registry);

  const ctxFactory = (runId: string): IRunContext => ({
    runId,
    logger: new ConsoleLogger(runId),
    drive,
    llm,
    storage,
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
