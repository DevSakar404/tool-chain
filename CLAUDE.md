# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

An agent built from small, ID-addressable, chainable units instead of an LLM that routes
every step at runtime. A **Node** is `kind: "tool"` (deterministic I/O — Drive, Gmail,
HTTP) or `kind: "skill"` (exactly one LLM call via `generateObject` + a Zod schema). A
**Chain** is a DB-stored ordered list of **Steps**, each wiring a node's inputs from the
trigger, a prior step's output, or a literal. A generic **ChainEngine** resolves each
mapping, validates the Zod contract in and out of every node, executes it, and persists a
per-step audit record (`StepRunRecord`). The full rationale is in
[`docs/PROPOSAL.md`](docs/PROPOSAL.md); the binding spec is
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — read it before making structural changes,
its "Architectural Decisions" table (D1–D16) is the reasoning behind almost every
non-obvious choice in the code.

Two packages: `packages/core` (framework-agnostic engine — no Next/Supabase deps) and
`apps/web` (Next.js App Router — the trigger UI, the visual chain editor, and the API
routes). `apps/web` always consumes `packages/core` via its **built** `dist/`, never
live source — this is the single most common source of confusing errors (see Gotchas).

## Commands

```bash
# Install (once, from repo root)
pnpm install

# Build core FIRST — apps/web resolves @tool-chain/core via dist/, not source
pnpm --filter @tool-chain/core build

# Typecheck / test everything (runs per-package, strict TS in both)
pnpm -r typecheck
pnpm -r test

# Single package
cd packages/core && npx tsc --noEmit -p tsconfig.json && npx vitest run
cd apps/web && npx tsc --noEmit && npx vitest run

# Single test file / pattern (vitest)
npx vitest run src/__tests__/engine/ChainEngine.golden.test.ts
npx vitest run -t "falls back to the secondary provider"

# Dev server (Next.js)
pnpm --filter @tool-chain/web dev
```

**Run core's test suite from `packages/core/`, not the repo root or via a path-qualified
`vitest run packages/core/...`.** The e2e test resolves fixtures via
`resolve(process.cwd(), "../../fixtures")` — a `process.cwd()`-relative path — so running
it from the wrong directory fails with an unrelated `ENOENT`, not a real bug.

**`pnpm -r <script>` runs each workspace package's own script** (defined per-package in
`packages/core/package.json` / `apps/web/package.json`), each with that package as its
cwd — this is why `pnpm -r test` works correctly for the e2e fixture path above but a
manual `vitest run` from root does not.

There is no root `eslint.config.js` despite the `lint` script and ARCHITECTURE.md's
mention of "eslint import-boundary rules" — that enforcement doesn't exist yet. Don't
assume `pnpm lint` catches package-boundary violations; enforce D11 (core must not import
Next/Supabase) by inspection until the config exists.

## Architecture: the pieces that don't fit in one file

**The three-layer LLM provider precedence** (`step.llmProvider` → `node.preferredLLM` →
global primary/fallback) is the trickiest cross-cutting concern in the codebase. It spans:
`contracts/dtos.ts` (`LLMProviderNameSchema` — the single source of truth the
`LLMProviderName` type infers from), `contracts/INode.ts` (`StepConfig`, threaded through
`execute`/`run`), `engine/ChainEngine.ts` (forwards `step.llmProvider` into `node.execute`),
`node/SkillNode.ts` (computes the effective `prefer` target), and
`infra/llm/VercelAILLMProvider.ts` (the de-duped prefer→primary→fallback attempt loop, and
the `fallbackUsed` flag on the successful attempt). Full design:
[`docs/superpowers/specs/2026-07-01-per-step-llm-selection-design.md`](docs/superpowers/specs/2026-07-01-per-step-llm-selection-design.md).
A **per-run** side-channel, `ctx.llmTrace` (`ILLMCallTraceSink` / `LLMCallTrace`), mirrors
`ctx.usage` (`IUsageSink` / `UsageAccumulator`) — both exist because a skill node's
`onResult` callback needs to report something (tokens, or provider+fallback trace) back up
to `ChainEngine` *after* `node.execute` returns, and `StepResult<O>`'s type has no room for
side-channel metadata. If you need to thread a third piece of per-call metadata from a node
back to the engine, this is the established pattern — don't invent a different one.

**Adding an LLM provider or a tool node has a dedicated skill** — see `.claude/skills/`
below. Don't hand-roll either from scratch; the skills encode the exact file list and
gotchas (e.g. `exactOptionalPropertyTypes` forcing `T | undefined` instead of `T?` in
several places, the `never`-exhaustiveness guard in `createLLMModel.ts`'s provider switch).

**`GoogleApiCapability`** (`infra/google/GoogleApiCapability.ts`) is a shared abstract base
for Google-family capabilities: bearer-auth fetch with retry/backoff, size enforcement, and
the buffer→sha256→`storage.upload`→`BlobHandle` tail. `GoogleDriveCapability` (export-vs-
download branching) and `GmailCapability` (MIME part-walk) are thin subclasses that only add
provider-specific request/parse logic and set `apiErrorCode`. A new Google API adapter
should extend this base, not duplicate it; a genuinely new non-Google service has no shared
base yet (see D2 in `add-tool-node`'s skill for when to factor one).

**The visual chain editor** (`apps/web/src/app/editor/[chainId]/page.tsx`,
`hooks/useChainEditor.ts`, `components/editor/*`) is a `useReducer` state machine
(`EditorAction` union in `useChainEditor.ts`) over a `Chain` fetched from
`GET /api/chains/[id]`. It edits the same `Chain`/`Step` DTOs the engine runs — there is no
separate editor-only schema. Constraints inherited from the engine (not enforced by the UI
type system, so don't assume the compiler catches a violation):
- Every `Ref` may only point at the trigger or a **strictly-earlier** step (linear
  execution, D5) — `computeValidation` in `useChainEditor.ts` is what actually checks this
  and flags `dangling-ref`.
- No `x`/`y` position fields anywhere in `Chain`/`Step` — canvas layout is computed from
  step order and is a pure UI concern, never persisted. Do not add position fields to the
  DTOs to "fix" a layout problem.
- The node catalog (`NodeCatalogEntry[]`, `GET /api/nodes`) is how the browser learns node
  shapes without importing Zod schemas client-side — `registry/describeNode.ts` converts a
  node's `inputSchema`/`outputSchema` to plain-JSON field descriptors. A new node is
  automatically editable in the UI once registered; you don't need to touch the editor.

**Persistence boundaries to keep in mind when touching `StepRunRecord`/`RunRecord`:**
only `{ name, message, code }` ever gets persisted from a thrown error (D8, the redaction
boundary in `di/buildEngine.ts`'s `toSafeError`) — never add a field to `SafeError` that
could carry a raw secret. Some `StepRunRecord` fields (e.g. `llmTarget`, `llmFallbackUsed`)
are intentionally UI/log-only in v1 and not persisted to Postgres — check
`SupabaseRunRepository`'s column whitelist before assuming a new DTO field round-trips
through the DB.

## Design-doc trail

Design specs are written *before* implementation and kept afterward as the historical
record — `docs/superpowers/specs/*.md`, one per feature, each dated. When picking up
related work, check for an existing spec first; when finishing a design conversation for a
non-trivial feature, a new dated spec is the expected artifact before writing code (see the
`implement-from-spec` skill). Note some specs describe intent slightly ahead of or behind
current code (e.g. `ARCHITECTURE.md` lists the visual editor as "out of scope for v1," but
`apps/web/src/app/editor/` already exists) — verify against the actual code, don't trust a
doc's scope claims at face value.

## Project-local skills

`.claude/skills/` (repo-scoped, travel with git — distinct from any skills in `~/.claude/skills/`):
- **`add-tool-node`** — add a new `kind: "tool"` node and register it in `NodeRegistry`.
- **`add-llm-model`** — add a new LLM provider or default model to the per-step selection
  system described above.

Both encode the exact file list, ordering, and known gotchas from having done each task
for real in this repo — use them instead of re-deriving the pattern from scratch.
