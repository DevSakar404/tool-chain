---
name: add-llm-model
description: Add a new LLM model or provider to the tool-chain engine's per-step LLM selection system. Use when the user wants to "add a new LLM model", "add [provider] as an option", "wire in an open source model", "add Qwen/Llama/Mistral/DeepSeek/etc.", "support a new model for [skill node]", or asks for the "best open source LLM" and wants it usable in the app. Covers both cases: adding a brand-new provider (e.g. OpenRouter, Together, Groq) and changing/adding a default model within an existing provider.
---

# Add an LLM Model / Provider

Wire a new LLM choice into the three-layer provider-selection system (`step.llmProvider` →
`node.preferredLLM` → global primary/fallback) described in
`docs/superpowers/specs/2026-07-01-per-step-llm-selection-design.md`. That spec is the
architectural source of truth — read it if this is your first time touching this area.

## First, decide which of two cases this is

1. **New model, existing provider** (e.g. switch Gemini's default model, or add a model
   override) — usually just a `DEFAULT_MODEL` map edit or an `llmModel` string. No schema
   change needed. Small — do it inline, no need for the full recipe below.
2. **New provider** (a service not already in `LLMProviderName`) — e.g. adding OpenRouter to
   reach open-source models (Llama, Qwen, Mistral, DeepSeek). This is the common case when a
   user asks for "the best open source LLM" — open-weight models aren't a provider themselves,
   they're served *through* one (OpenRouter, Together, Fireworks, Groq, or self-hosted vLLM).
   Follow the full recipe below.

If the user just says "add an open source model" without naming a serving path, ask which
provider to route through — recommend **OpenRouter** (one API key, one OpenAI-compatible
adapter, access to most open-weight model families) unless they already have a preferred
inference vendor.

## Mental model — five moving parts, in order

```
schema   (contracts/dtos.ts)         ──► LLMProviderNameSchema enum        [ALWAYS]
factory  (infra/llm/createLLMModel.ts) ──► maps provider+model → SDK model [ALWAYS]
di       (di/buildEngine.ts)         ──► per-provider API key resolution  [ALWAYS]
env      (apps/web engineSingleton + .env.example) ──► surfaces the key   [ALWAYS]
UI       (NodeInspector.tsx dropdown) ──► lets a chain step pick it       [ALWAYS]
```

Every one of these five files changes for a new provider — this is a horizontal enum
extension, not a vertical feature, so the diff is "one more branch/case/option" repeated
five times, not a new abstraction anywhere.

## Recipe

### Step 1 — Pick the SDK adapter package

Check what the Vercel AI SDK version in `packages/core/package.json` (`"ai": "^X.0.0"`)
actually supports before installing anything:

```bash
npm view <candidate-package> peerDependencies
```

- A **named official adapter** exists for major providers (`@ai-sdk/google`,
  `@ai-sdk/anthropic`, `@ai-sdk/mistral`, etc.) — use it if the peer `ai` version matches.
- For **OpenAI-compatible endpoints** (OpenRouter, Together, Fireworks, Groq, self-hosted
  vLLM/Ollama) use **`@ai-sdk/openai-compatible`**, not a vendor-specific wrapper package —
  vendor wrappers (e.g. `@openrouter/ai-sdk-provider`) often pin to a newer major `ai` version
  than this repo uses. Check the peer dep before adding either.
- Match the adapter's dependency generation to the ones already installed
  (`@ai-sdk/provider`, `@ai-sdk/provider-utils` versions) so you don't drag in a second
  major of shared transitive deps.

Install with the exact version you verified:
```bash
cd packages/core && npm install @ai-sdk/<adapter>@<verified-version>
```

### Step 2 — Extend the schema (single source of truth)

`packages/core/src/contracts/dtos.ts`:
```typescript
export const LLMProviderNameSchema = z.enum(["anthropic", "gemini", "<new>"]);
```
`LLMProviderName` in `contracts/IRunContext.ts` is `z.infer<typeof LLMProviderNameSchema>` —
it updates automatically. Do not hand-maintain a parallel string union.

### Step 3 — Add the factory branch

`packages/core/src/infra/llm/createLLMModel.ts` — add the model default and a switch case:
```typescript
const DEFAULT_MODEL: Record<LLMProviderName, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  gemini: "gemini-2.0-flash",
  "<new>": "<vendor>/<default-model-id>",
};
// ...
case "<new>": {
  const client = createOpenAICompatible({ name: "<new>", baseURL: "<base-url>", apiKey: opts.apiKey });
  return client(model);
}
```
The `default:` branch's `const _exhaustive: never = opts.provider` guard means TypeScript
fails the build if you forget a case here — that's intentional, don't cast around it.

### Step 4 — Wire the API key through `buildEngine`

`packages/core/src/di/buildEngine.ts`, three spots:
1. Add `<new>ApiKey?: string | undefined` to `BuildEngineOptions`.
2. Add it to `apiKeyFor`'s branch and the `ENV_VAR_FOR` map (used in the missing-key error).
3. Add it to the `apiKeys` per-provider map (this is what lets a *step-level* preference for
   this provider resolve even when it's neither the global primary nor fallback).

### Step 5 — Surface the env var

- `apps/web/src/lib/engineSingleton.ts`: `<new>ApiKey: process.env["<NEW>_API_KEY"] ?? ""`.
- `.env.example`: document the var, where to get a key, and what it defaults to.

### Step 6 — Add the UI option

`apps/web/src/components/editor/NodeInspector.tsx`'s LLM Provider `<select>` (gated on
`kind === "skill"`): add one `<option value="<new>">Label</option>` and extend the inline
cast `as "anthropic" | "gemini" | ...` in the `onChange` handler.

### Step 7 — Rebuild core before touching apps/web

`apps/web` resolves `@tool-chain/core` via its built `dist/`, not live source:
```bash
cd packages/core && npx tsc -p tsconfig.json
```
Skipping this makes `apps/web`'s typecheck fail with "property does not exist" on the new
enum member even though the source is correct — rebuild first, always.

### Step 8 — Tests

Mirror the existing coverage instead of inventing new patterns:
- `__tests__/contract/dtos.test.ts` — schema accepts the new enum value.
- `__tests__/infra/VercelAILLMProvider.test.ts` — add a `vi.mock` for the new adapter package
  (same shape as the existing `@ai-sdk/anthropic`/`@ai-sdk/google` mocks) and one test that a
  node's preference for the new provider routes through it with the right default model.
- `__tests__/hooks/useChainEditor.reducers.test.ts` (apps/web) — `SET_STEP_PROVIDER` accepts
  the new value.

### Step 9 — Verify

```bash
cd packages/core && npx tsc --noEmit -p tsconfig.json && npx vitest run
cd apps/web && npx tsc --noEmit && npx vitest run
```
Run core's suite from `packages/core/` (not repo root) — the e2e test resolves fixtures via
`process.cwd()`-relative paths and fails with an unrelated ENOENT otherwise.

## Completeness checklist

- [ ] Adapter package's peer `ai` version matches this repo's (`npm view <pkg> peerDependencies`).
- [ ] `LLMProviderNameSchema` is the only place the enum is declared; `LLMProviderName` derives from it.
- [ ] New `case` in `createLLMModel.ts`'s switch (the `never` exhaustiveness guard should force this).
- [ ] `buildEngine.ts`: `BuildEngineOptions` field, `apiKeyFor`/`ENV_VAR_FOR`, and `apiKeys` map all updated.
- [ ] Env var wired in `engineSingleton.ts` and documented in `.env.example`.
- [ ] UI dropdown option added in `NodeInspector.tsx`, cast list extended.
- [ ] `packages/core` rebuilt (`tsc -p tsconfig.json`) before checking `apps/web`.
- [ ] Tests added at all three levels (dto, provider, reducer); full suite green in both packages.

## Common mistakes

| Mistake | Fix |
|---|---|
| Installing a vendor-specific SDK wrapper without checking its peer `ai` version | Check `npm view <pkg> peerDependencies` first; prefer `@ai-sdk/openai-compatible` for OpenAI-compatible endpoints — it tracks the same `ai` v4 generation as this repo's other adapters. |
| Hand-adding `"<new>"` to a second string union somewhere | There should be exactly one: `LLMProviderNameSchema`. Everything else infers from it. |
| Forgetting the `apiKeys` map entry in `buildEngine.ts` | Global primary/fallback works, but a *step-level* preference for the new provider silently falls through to the global chain — add it. |
| Typechecking `apps/web` without rebuilding `packages/core` first | `apps/web` imports the built `dist/`, not source — stale dist means false "property does not exist" errors. |
| Running core's test suite from the repo root | The e2e test's fixture path is `process.cwd()`-relative; run from `packages/core/`. |
| Picking a vendor wrapper package (e.g. `@openrouter/ai-sdk-provider`) over the generic OpenAI-compatible adapter | Vendor wrappers add a dependency for what `@ai-sdk/openai-compatible` already does generically — only reach for one if it does something the generic adapter can't. |

## Quick reference

```
1. Verify adapter peer-dep matches installed `ai` version; install exact version
2. LLMProviderNameSchema enum += "<new>"                    (dtos.ts)
3. DEFAULT_MODEL += entry, switch += case                    (createLLMModel.ts)
4. BuildEngineOptions + apiKeyFor + ENV_VAR_FOR + apiKeys    (buildEngine.ts)
5. env var: engineSingleton.ts + .env.example
6. UI <option> + cast list                                   (NodeInspector.tsx)
7. rebuild core (tsc -p tsconfig.json) BEFORE checking apps/web
8. tests: dtos, VercelAILLMProvider mock, reducer
9. typecheck + test both packages (core tests from packages/core/, not root)
```
