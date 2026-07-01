# Tool-Chain — Architecture Spec & Implementation Plan

**Goal:** Build a system that assembles an agent by chaining small, reusable, ID-addressable units (tools and skills) into a linear pipeline; ship one working chain end-to-end: Google Drive file → extracted text → parsed resume JSON.

**Architecture:** A universal `Node` abstraction (`kind = tool` deterministic-I/O | `skill` LLM-reasoning) with Zod input/output contracts. Chains are DB-stored ordered steps that reference nodes by id and map prior outputs to inputs. A generic engine resolves mappings, validates each boundary, runs the node, and persists a run + per-step audit trail. Code is the source of truth for node logic; Supabase catalogs metadata and stores chains + runs.

**Tech Stack:** TypeScript (strict), Next.js (App Router), Vercel AI SDK (`generateObject`, provider-agnostic; default Anthropic `claude-haiku-4-5-20251001`, overridable via `LLM_MODEL`), Supabase (Postgres + Storage), Zod, Vitest, shadcn/ui + Tailwind, pnpm.

---

## Context

We are building toward an "agent assembled from chained skills and tools." For now the chain is **linear** (a pipeline); the long-term goal is **non-linear (DAG/agentic)**. The core requirement is that each tool/skill be the **smallest possible reusable unit** with a **stable ID** so chains are formed by referencing IDs.

**v1 framing: CHAIN-FIRST.** The acceptance test is: *the Drive→resume chain runs end-to-end with recorded fixtures and produces correct JSON.* The engine is the **minimum clean code that passes that test** — not a deliverable in its own right. This framing deliberately prevents over-engineering.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Node** | The atomic, ID-addressable unit of work. One node = one file = one job. |
| **Tool** | A node performing deterministic I/O (Drive, Supabase, HTTP). No LLM. |
| **Skill** | A node performing LLM reasoning via `generateObject` + a Zod output schema. |
| **Chain** | A DB-stored, ordered list of steps that wires nodes together into a pipeline. |
| **Step** | One position in a chain: a `nodeId` plus an `inputMapping`. |
| **Ref** | How a step's input field is sourced: from the trigger, a prior step, or a literal. |
| **Run / StepRun** | Persisted audit records of a chain execution and each of its steps. |
| **BlobHandle** | A reference to a file in Storage (`storageRef`, `mime`, `size`, `sha256`) — what flows through the pipeline instead of raw bytes. |

---

## Global Constraints

- **Language:** TypeScript, `strict: true`. No `any`; interfaces + DTOs at all data boundaries.
- **OOP/SOLID:** Constructor injection of interfaces (real Dependency Inversion). One class = one reason to change. Engine never changes when a node is added (Open/Closed).
- **DRY:** Shared validate-in/validate-out lives in `BaseNode`.
- **TDD (mandatory):** Red → Green → Refactor. Tests/contracts written **before** implementation. Lead with **contract + golden-path + one e2e** tests, NOT unit tests of engine internals.
- **Defensive:** Custom domain exceptions; no empty catch blocks; typed step results (not throw-only) for expected failures.
- **Security:** Nodes receive **capability handles**, never raw secrets. A single redaction boundary on the persistence path. Auth gate on the run API route.
- **Granularity:** One node = one file = one job.
- **No binary bytes through Zod/jsonb.** Files go to Supabase Storage; only blob handles flow through the pipeline.

---

## Architectural Decisions (the "why")

| # | Decision | Why |
|---|----------|-----|
| D1 | **Node** is the one abstraction; `kind: "tool" \| "skill"` discriminates. Single `INode.execute(input, ctx)`. | Liskov-safe substitution at the engine boundary. Merge `ITool`/`ISkill` until they diverge. |
| D2 | **Tool** = deterministic I/O, no LLM. **Skill** = LLM via `generateObject` + Zod output schema. | Stated distinction. Different runtimes, same contract. |
| D3 | **Typed Zod schemas** per node, validated at each boundary. | Self-documenting contracts; chains validatable; fail-fast with clear errors. |
| D4 | **Chains are DB rows**: ordered `Step[]`, each `{ stepId, nodeId, inputMapping }`. `Ref = {from:"trigger",path} \| {from:stepId,path} \| {value}`. | Matches "chain from IDs"; future UI builds chains without redeploy. |
| D5 | **Ref model is DAG-ready** (can point to ANY earlier step) but v1 executor resolves linearly only. | Cheap now, painful to retrofit; it's baked into persisted rows. Code linear; data DAG-ready. |
| D6 | **Binary files → Supabase Storage; pipeline carries a blob handle.** | base64 in jsonb is a dead end: OOM, ~33% bloat, duplicated data, fragile row sizes. |
| D7 | **Nodes receive capability handles** (e.g. `download(fileId)`), never raw keys. | SDK errors embed credentials; persisting raw errors would leak secrets into the DB. |
| D8 | **Persistence redaction boundary**: persist only `{ name, message, code }`; never raw thrown objects. | Prevents secret/PII leakage into `step_runs.error`. |
| D9 | **Typed step result**: `Ok \| InputInvalid \| NodeError \| OutputInvalid` — not throw-only. | An LLM returning a malformed object is a *normal expected* outcome of `generateObject`. |
| D10 | **No DI container.** One manual composition-root factory (`buildEngine()`). | A container is overkill for single-process v1. Keep constructor injection; drop the framework. |
| D11 | **2 packages**, not 4: `core` (no Next/Supabase deps) + `app`. `nodes/`, `infra/` are directories inside `core`, enforced by lint boundaries. The Supabase client is **typed structurally** in core (`SupabaseDb` / `SupabaseClientLike` in `SupabaseTypes.ts`), not imported, so `@supabase/supabase-js` stays out of core. `apps/web` passes the real `createClient()` result with no cast; `buildEngine` does the single narrowing to `SupabaseDb`. | Publishable packages cost overhead and buy nothing until externally consumed. Keeping the client out of core preserves the framework-agnostic boundary. |
| D12 | **`ChainValidator` is inlined** type-compat check in the executor, not a class. DAG-cycle detection deferred. | Linear chain validation collapses to "node N output type satisfies node N+1 input type." |
| D13 | **Drive export-vs-download branching.** Google Docs need `files.export`; binary files use `get?alt=media`. Set `supportsAllDrives`. | v1-blocking: people store resumes as Google Docs. |
| D14 | **Min-content gate** between extract and parse → typed "no extractable text". | Empty/garbage text (image-only PDF) poisons the LLM step. |
| D15 | **Auth gate on run API route** (shared secret for v1). The only real endpoint is `POST /api/chains/[id]/run`; a catch-all `[...rest]/route.ts` + a `GET` handler on the run route return actionable JSON (not a bare 404/405) for malformed paths or wrong methods. | Service-role key bypasses all DB protection; the route must not be open. Clear 404/405 messages stop callers from silently hitting the wrong URL (e.g. omitting the chain id). |
| D16 | **Frontend = shadcn/ui trigger UI**; generative-UI deferred but architected for (run API streams structured events; result render is an isolated component). | Normal UI now, gen-ui capability later without rework. |

**Deferred (tracked, not forgotten):** RLS/multi-tenant, retry/backoff as node metadata, idempotency keys, run TTL/retention, `version` columns, `nodes` catalog reconciliation logic, prompt-injection hardening (bounded by strict `generateObject` schema in v1).

---

## File Structure (divide & rule — small files)

```
tool-chain/
├── packages/
│   └── core/                              # framework-agnostic; deps: zod, ai-sdk (no Next/Supabase in engine)
│       ├── src/
│       │   ├── contracts/
│       │   │   ├── INode.ts               # INode, NodeKind, NodeMeta
│       │   │   ├── IRunContext.ts         # ILogger + capability handles + repos + runId
│       │   │   ├── IRepositories.ts       # IChainRepository, IRunRepository, IStorage
│       │   │   ├── dtos.ts                 # Chain, Step, Ref, RunRecord, StepRunRecord, BlobHandle, StepResult
│       │   │   └── index.ts
│       │   ├── errors/index.ts            # ChainError, NodeNotFoundError, SchemaValidationError, StepExecutionError
│       │   ├── node/
│       │   │   ├── BaseNode.ts            # abstract: validate-in/out wrapper -> StepResult (DRY)
│       │   │   ├── ToolNode.ts            # extends BaseNode; runs handler(input, ctx)
│       │   │   └── SkillNode.ts           # extends BaseNode; runs ctx.llm.generateObject(...)
│       │   ├── registry/NodeRegistry.ts   # id -> INode; register/get/list
│       │   ├── engine/
│       │   │   ├── InputResolver.ts       # resolve Ref/inputMapping (dotted path)
│       │   │   └── ChainEngine.ts         # orchestrate steps linearly; persist; inline type-compat check
│       │   ├── nodes/                     # THE reusable units (one file each)
│       │   │   ├── tools/drive.download_file.ts     # -> BlobHandle (Drive -> Storage)
│       │   │   ├── tools/document.extract_text.ts   # BlobHandle -> { text }; min-content gate
│       │   │   ├── skills/resume.parse_fields.ts    # { text } -> ResumeDTO JSON
│       │   │   └── index.ts               # registerAll(registry)
│       │   ├── infra/                     # concrete adapters (implement contracts)
│       │   │   ├── supabase/{SupabaseChainRepository,SupabaseRunRepository,SupabaseStorage}.ts
│       │   │   ├── google/GoogleApiCapability.ts    # shared base: auth fetch, retry, size guard, store->BlobHandle
│       │   │   ├── drive/GoogleDriveCapability.ts   # export-vs-download
│       │   │   ├── gmail/GmailCapability.ts         # part-walk, base64url attachment -> BlobHandle
│       │   │   ├── llm/VercelAILLMProvider.ts       # generateObject
│       │   │   └── logging/ConsoleLogger.ts
│       │   ├── di/buildEngine.ts          # composition root (manual wiring) + redaction helper
│       │   └── index.ts
│       └── __tests__/
│           ├── contract/INode.conformance.ts
│           ├── engine/ChainEngine.golden.test.ts
│           ├── nodes/*.test.ts
│           └── e2e/resume-chain.e2e.test.ts
├── apps/web/                              # Next.js (App Router) — thin edge
│   ├── app/api/chains/[id]/run/route.ts   # auth gate; POST streams SSE; GET → 405 + usage
│   ├── app/api/chains/[...rest]/route.ts  # catch-all → 404 + "chain id is required" for bad paths
│   ├── app/page.tsx                        # shadcn/ui trigger UI + isolated <ResultView>
│   ├── components/ui/                      # shadcn/ui
│   └── .env.local                          # symlink → ../../.env.local (Next loads env from here)
├── supabase/migrations/                   # chains, runs, step_runs; Storage bucket
├── fixtures/                              # recorded Drive file + LLM cassette for e2e
└── package.json / pnpm-workspace.yaml / tsconfig.json (strict) / vitest.config.ts / eslint
```

---

## Key Interfaces (the seams everything hangs off)

```typescript
// contracts/dtos.ts
export interface BlobHandle { storageRef: string; mime: string; size: number; sha256: string }

export type Ref =
  | { from: "trigger"; path: string }
  | { from: string; path: string }      // stepId
  | { value: unknown };

export interface Step { stepId: string; nodeId: string; inputMapping: Record<string, Ref> }
export interface Chain { id: string; name: string; triggerSchemaName?: string; steps: Step[]; schemaVersion: number }

export type StepResult<T> =
  | { ok: true; output: T }
  | { ok: false; kind: "InputInvalid" | "NodeError" | "OutputInvalid";
      error: { name: string; message: string; code?: string } };

// contracts/INode.ts
export type NodeKind = "tool" | "skill";
export interface INode<I = unknown, O = unknown> {
  readonly id: string;
  readonly kind: NodeKind;
  readonly inputSchema: ZodType<I>;
  readonly outputSchema: ZodType<O>;
  execute(input: unknown, ctx: IRunContext): Promise<StepResult<O>>;
}

// contracts/IRunContext.ts — capability handles, NOT raw keys (D7)
export interface IRunContext {
  runId: string;
  logger: ILogger;
  drive: IDriveCapability;          // download(fileId): Promise<BlobHandle>  (auth hidden in adapter)
  llm: ILLMProvider;                // generateObject<T>(schema, prompt, input): Promise<T>
  storage: IStorage;
}
```

---

## The v1 Chain (data, not code)

```
trigger: { fileId }
s1  drive.download_file      input.fileId    <- trigger.fileId        => BlobHandle
s2  document.extract_text    input.{storageRef,mime,size,sha256}      => { text }
                                             <- s1.{storageRef,mime,size,sha256}
s3  resume.parse_fields      input.text      <- s2.text               => ResumeDTO
result: s3.output
```

> **Note:** `document.extract_text` takes a **flat `BlobHandle`** as its input
> schema (not a `{ file: BlobHandle }` wrapper), so `s2`'s `inputMapping` wires
> each `BlobHandle` field from `s1`'s output individually. See
> [`fixtures/resume-chain.json`](../fixtures/resume-chain.json) for the exact mapping.

`ResumeDTO`: `{ name, experience[], keyProjects[], college }`.

---

## Implementation Tasks (TDD, one deliverable each)

1. **Repo scaffold** — pnpm workspace (`packages/core` + `apps/web`), strict tsconfig, vitest, eslint import-boundary rules, deps.
2. **DTOs, errors, StepResult** — Zod schemas for `Step`/`Ref`/`Chain`; custom exceptions. Tests first.
3. **BaseNode + INode conformance suite** — the highest-value test; `BaseNode`/`ToolNode`/`SkillNode`.
4. **NodeRegistry + InputResolver** — id→INode; resolve refs via dotted path; typed errors.
5. **ChainEngine golden path** — 2 fake nodes; A's output → B's input; persist a step_run each; redaction.
6. **`drive.download_file`** — `{fileId}` → `BlobHandle` via `ctx.drive.download`; never returns bytes.
7. **`document.extract_text`** — `BlobHandle` → `{text}`; mime-routed pdf-parse/mammoth + Drive export; min-content gate.
8. **`resume.parse_fields`** — `ResumeDTO` schema; `{text}` → `ResumeDTO` via mocked `generateObject`; malformed → `OutputInvalid`.
9. **Infra adapters** — GoogleApiCapability (shared base: auth fetch, retry, size guard, store→BlobHandle) subclassed by GoogleDriveCapability (export-vs-download, `supportsAllDrives`) and GmailCapability (part-walk, base64url attachment); VercelAILLMProvider, Supabase repos + Storage, ConsoleLogger.
10. **Supabase migrations** — `chains`, `runs`, `step_runs` (jsonb, `schema_version`), Storage bucket; no RLS (deferred).
11. **`buildEngine` composition root** — manual wiring + redaction helper.
12. **Next.js run API + auth gate** — server-only, shared-secret gate, streams structured events.
13. **shadcn/ui trigger UI** — form → run → isolated `<ResultView>` (the gen-ui swap point).
14. **e2e with recorded fixtures** — full chain via `buildEngine` asserts `ResumeDTO`. **Passing = v1 done.**

---

## Verification (end-to-end)

1. `pnpm install`, then **build core first** (`pnpm --filter @tool-chain/core build`) — `apps/web` resolves `@tool-chain/core` via its built `dist/`, so a fresh checkout fails typecheck until core is built.
2. `pnpm -r typecheck` → no errors (strict, both packages).
3. `pnpm -r test` → unit + conformance + golden-path green.
4. `pnpm test e2e/resume-chain` → recorded chain produces correct `ResumeDTO`. **v1 acceptance gate.**
5. Apply migrations + create the `pipeline-blobs` Storage bucket; insert the chain row (see `fixtures/resume-chain.json`); set env in **`.env.local`**:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `GOOGLE_ACCESS_TOKEN` (OAuth2 `ya29...` access token, scope `drive.readonly`; **expires ~1h**, refresh as needed)
   - `ANTHROPIC_API_KEY`, optional `LLM_MODEL` (defaults to `claude-haiku-4-5-20251001`)
   - `RUN_API_SECRET` and `NEXT_PUBLIC_RUN_API_SECRET` (**must be equal**), `NEXT_PUBLIC_RESUME_CHAIN_ID` (the chain row's UUID)

   > **Env location:** Next.js loads `.env.local` from `apps/web/`. The repo keeps a single root `.env.local` and symlinks `apps/web/.env.local → ../../.env.local` so there is one source of truth. The route caches the engine per cold start, so **restart `dev` after any env change**.
6. `pnpm --filter @tool-chain/web dev`; share a real resume (PDF and a Google Doc) with the account whose token you use; enter its fileId in the UI; confirm streamed JSON. Verify `step_runs` holds blob handles (not bytes) and no secrets in `error`.

---

## Out of Scope for v1 (explicit)

Visual chain-builder UI · generative UI rendering · non-linear/DAG execution · multi-tenant/RLS/auth beyond the run-route secret · node versioning + version-pinned chain refs · retry/idempotency metadata on nodes · `nodes` catalog table + reconciliation · run retention/TTL.
