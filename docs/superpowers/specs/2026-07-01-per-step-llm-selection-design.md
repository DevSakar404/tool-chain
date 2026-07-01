# Per-Step LLM Selection — Design Spec

**Author:** Sakar
**Date:** 2026-07-01
**Status:** Design (approved, pre-implementation)
**Companion docs:** [`ARCHITECTURE.md`](../../ARCHITECTURE.md) · [`PROPOSAL.md`](../../PROPOSAL.md)

---

## TL;DR

A chain step can pin which LLM provider (`anthropic` | `gemini`) a **skill node**
runs on, chosen as a field in the step's JSON and surfaced as a dropdown in the
chain editor. This completes a three-layer precedence — **step override → skill
default → global default/fallback** — of which only the lower two layers exist
today. When the chosen provider fails at runtime, the existing global fallback
still serves the call (uptime preserved), but the step-run is **flagged** as
fallback-served so the audit trail stays honest.

This is a small, contained feature: five focused changes, no new dependency, no
DB migration.

---

## Motivation

Per [`PROPOSAL.md`](../../PROPOSAL.md), a skill node is "exactly one LLM call."
Which model serves that call is a **property of the route**, not a hidden runtime
decision. Today the provider can only be pinned in code (`node.preferredLLM`) or
set globally (`buildEngine`). There is no way for a *chain* to say "run this skill
on Gemini for this pipeline" — the route lives in the DB (D4/D5), so provider
selection belongs there too. The code already anticipates this: the comment on
[`resume.parse_fields.ts`](../../../packages/core/src/nodes/skills/resume.parse_fields.ts)
promises "the future tool-registry 'preferred LLM' column will source this field."

## Current state (verified against code)

What already works — do **not** rebuild:

- `LLMProviderName = "anthropic" | "gemini"` and `LLMTarget` — [`IRunContext.ts:40`](../../../packages/core/src/contracts/IRunContext.ts)
- `createLLMModel` maps both providers to Vercel AI SDK models; `@ai-sdk/google` wired — [`createLLMModel.ts`](../../../packages/core/src/infra/llm/createLLMModel.ts)
- `node.preferredLLM` skill default — [`BaseNode.ts:26`](../../../packages/core/src/node/BaseNode.ts)
- `generateObject(..., prefer?, onResult?)` with a de-duped `prefer → primary → fallback` attempt chain gated on API-key presence — [`VercelAILLMProvider.ts:69`](../../../packages/core/src/infra/llm/VercelAILLMProvider.ts)
- `buildEngine` resolves per-provider keys, throws early on a missing key — [`buildEngine.ts:88`](../../../packages/core/src/di/buildEngine.ts)
- Chain `steps` stored/read verbatim through a jsonb column — `SupabaseChainRepository`

What is **missing** (this spec adds it): the top precedence layer. `StepSchema`
has no `llmProvider` field, the engine never forwards step config to the node, and
no node computes an effective target. Until all three land, precedence is only
two-layer and any JSON `llmProvider` is silently stripped by Zod at parse.

---

## The three-layer precedence

Highest wins; each unset layer falls through to the next:

```
step.llmProvider          chain overrides, per-pipeline        ← NEW (this spec)
  ↓ unset
node.preferredLLM         the skill's own default              ← exists
  ↓ unset
global primary → fallback engine default + resilience         ← exists
```

- **"A skill always calls Gemini"** → set `preferredLLM = { provider: "gemini" }`
  on the node. Every chain inherits it unless a step overrides.
- **"Override for this chain"** → set `llmProvider: "anthropic"` on that step's JSON.
- **"If it fails, retry elsewhere"** → the global fallback already handles this;
  this spec makes the retry *visible* (below).

The JSON selects a **provider only**, at the provider's default model
(`gemini-2.0-flash` / `claude-haiku-4-5-20251001`). A per-step *model* string is
deferred (YAGNI).

---

## Changes (five, ordered)

### 1. Schema — `StepSchema` gains an optional provider

[`packages/core/src/contracts/dtos.ts:31`](../../../packages/core/src/contracts/dtos.ts)

```typescript
export const LLMProviderNameSchema = z.enum(["anthropic", "gemini"]);

export const StepSchema = z.object({
  stepId: z.string().min(1),
  nodeId: z.string().min(1),
  inputMapping: z.record(z.string(), RefSchema),
  llmProvider: LLMProviderNameSchema.optional(),   // NEW
});
```

`LLMProviderName` in [`IRunContext.ts:40`](../../../packages/core/src/contracts/IRunContext.ts)
becomes `z.infer<typeof LLMProviderNameSchema>` so the enum is the single source of
truth (schema and TS type cannot drift). **This is the gate:** `StepSchema` is a
bare `z.object`, so Zod v3 strips unknown keys — without this field the JSON
`llmProvider` vanishes at `SupabaseChainRepository` parse and never reaches the
engine. Enum, not `z.string()`, so bad values are rejected at chain load and the UI
shares the constraint. Trade-off: adding a third provider later touches this enum
(acceptable — it's the one intended edit point).

### 2. Engine — forward step config into `execute`

[`packages/core/src/contracts/INode.ts`](../../../packages/core/src/contracts/INode.ts) ·
[`BaseNode.ts:33`](../../../packages/core/src/node/BaseNode.ts) ·
[`ChainEngine.ts:103`](../../../packages/core/src/engine/ChainEngine.ts)

Add an optional 3rd param — **verified non-breaking**: `execute` is declared in
exactly two places (the `INode` interface and `BaseNode`), every call site passes
two args, and no conformance test inspects arity. Tool nodes ignore it.

```typescript
// INode + BaseNode
execute(input: unknown, ctx: IRunContext, stepConfig?: StepConfig): Promise<StepResult<O>>;
// where
export interface StepConfig { llmProvider?: LLMProviderName }
```

`BaseNode.execute` threads `stepConfig` into `run(input, ctx, stepConfig)`
(the protected `run` gains the same optional param). `ChainEngine` line 103:

```typescript
const result = await node.execute(resolvedInput, ctx, { llmProvider: step.llmProvider });
```

`step` is already in scope (loop var, line 64). `IRunContext` is **untouched** —
this is per-step config, not per-run.

### 3. Node — compute the effective target

[`SkillNode.ts`](../../../packages/core/src/node/SkillNode.ts) ·
[`resume.parse_fields.ts`](../../../packages/core/src/nodes/skills/resume.parse_fields.ts)

`run` receives `stepConfig` and computes the `prefer` arg — this is layer-1-beats-2:

```typescript
protected override async run(input: I, ctx: IRunContext, stepConfig?: StepConfig): Promise<O> {
  const prefer: LLMTarget | undefined =
    stepConfig?.llmProvider ? { provider: stepConfig.llmProvider } : this.preferredLLM;
  return ctx.llm.generateObject<O>(this.outputSchema, this.systemPrompt, input, prefer, /* onResult */ …);
}
```

`ResumeParseFieldsNode.run` gets the same one-line change. Layer 3 (primary →
fallback) is handled inside `generateObject` and needs no change here.

### 4. Fallback flag — a boolean from the provider, not string-matching

[`VercelAILLMProvider.ts:104`](../../../packages/core/src/infra/llm/VercelAILLMProvider.ts) ·
[`IRunContext.ts:64`](../../../packages/core/src/contracts/IRunContext.ts) ·
[`SkillNode.ts:29`](../../../packages/core/src/node/SkillNode.ts)

**Ground truth is the attempt-loop index, not the `target` label.** The label is
`${provider}:${model}`, so comparing it against the requested provider misreads a
same-provider/different-model fallback as "no fallback," and the common case
(`resume.parse_fields` declares no `preferredLLM`) has nothing to compare against.

Add one field to `LLMCallResult`:

```typescript
export interface LLMCallResult {
  usage: TokenUsage;
  messageId?: string; requestId?: string; target?: string;
  fallbackUsed: boolean;   // NEW — true when a non-first attempt served the call
}
```

In `generateObject`, on the successful attempt set `fallbackUsed: i > 0`
(index `i` from the attempt loop). `SkillNode`'s existing `onResult` callback
already logs `target`; it additionally records `target` + `fallbackUsed` onto the
step-run.

**Persistence:** UI + logs only (no migration). The flag rides on the
`StepRunRecord` in memory and surfaces in the UI; the existing
`ctx.logger.info("LLM call", { target })` line already captures it. `StepRunRecord`
gains optional `llmTarget?: string` / `llmFallbackUsed?: boolean`, safe to add
because `createStepRun` uses an explicit column whitelist (the new fields are
simply not persisted to Postgres in v1). Add a queryable column later only if
fallback-rate analytics are needed.

### 5. UI — dropdown for every skill step

[`useChainEditor.ts:14`](../../../apps/web/src/hooks/useChainEditor.ts) ·
[`NodeInspector.tsx`](../../../apps/web/src/components/editor/NodeInspector.tsx) ·
[`RefEditor.tsx:122`](../../../apps/web/src/components/editor/RefEditor.tsx)

- **New reducer action** — `SET_REF` only writes Ref-shaped `inputMapping[field]`
  and cannot set a step scalar. Add to the `EditorAction` union:
  `{ type: "SET_STEP_PROVIDER"; stepId: string; provider?: LLMProviderName }`
  plus a reducer case that sets `step.llmProvider` (clearing it when `undefined`),
  marks the editor dirty, and recomputes validation — mirroring the `SET_REF` case.
- **Control** — a native `<select>` (there is **no** `components/ui`/shadcn in this
  repo; do not scaffold one for a single control), styled to match the existing
  `<select>` in [`RefEditor.tsx:122`](../../../apps/web/src/components/editor/RefEditor.tsx).
  Options: *Default* (unset → falls through to skill/global), *Anthropic*, *Gemini*.
- **Placement** — rendered in `NodeInspector`, gated on `node.kind === "skill"`, so
  every current and future skill node gets it for free (no node-id special-case).

---

## Testing (TDD — contract + golden + one e2e, per ARCHITECTURE §Global Constraints)

1. **DTO** — `StepSchema` accepts a valid `llmProvider`, rejects a bad enum value,
   and a step *without* the field still parses (back-compat). Confirms the field
   survives parse instead of being stripped.
2. **SkillNode precedence** — with a mock `ILLMProvider`, assert the `prefer` arg:
   step override wins over `preferredLLM`; `preferredLLM` wins when no override;
   `undefined` when neither is set.
3. **Engine golden** — a chain whose skill step has `llmProvider: "gemini"` results
   in `node.execute` receiving `{ llmProvider: "gemini" }`; the step-run records
   `llmTarget`.
4. **Fallback flag** — a mock provider that fails the first attempt and succeeds the
   second reports `fallbackUsed: true`; the step-run's `llmFallbackUsed` is `true`.
   First-attempt success → `false`.
5. **UI reducer** — `SET_STEP_PROVIDER` sets/clears `step.llmProvider`, marks dirty,
   and revalidates ([`useChainEditor.reducers.test.ts`](../../../apps/web/src/__tests__/hooks/useChainEditor.reducers.test.ts)).

---

## Out of scope (deliberate)

Per-step *model* override (only provider is selectable) · a queryable
`step_runs.llm_*` Postgres column (log/UI visibility is enough for v1) · shadcn/ui ·
provider selection for tool nodes (they make no LLM call) · a third provider.

---

## Open questions

None — all decisions resolved during brainstorming (fallback = flag-not-block;
persistence = UI/logs only; UI scope = all skill nodes; wiring = `Step` field, not
`inputMapping` reuse).
