# Design: Show LLM token usage at chain completion

**Date:** 2026-06-30
**Status:** Approved (pending spec review)

## Goal

When a chain run completes, show the **total** number of tokens consumed by LLM
(skill) calls. Persist that total to the run audit trail so it survives reloads
and appears in the recorded run history — not just live in the UI.

Scope confirmed with the user:
- **Granularity:** total tokens only (not per-step, not prompt/completion split).
- **Persistence:** persist to the run audit **and** show live.

## Background — the path a token count must travel

`generateObject` (Vercel AI SDK v4) returns `{ object, usage }`, where
`usage = { promptTokens, completionTokens, totalTokens }`. Today the system
discards everything except `object` at the very first hop:

- `VercelAILLMProvider.generateObject()` destructures only `const { object }`
  and returns `T`. (`packages/core/src/infra/llm/VercelAILLMProvider.ts:105`)
- `ILLMProvider.generateObject` is typed to return `T` — there is **no place**
  in the contract to carry usage.
- `SkillNode.run` → `BaseNode.execute` wraps the result into `StepResult<O>`;
  `ChainEngine` persists it into a `StepRunRecord` and emits SSE `step:done`
  events. None of these carry usage.
- The UI (`useChainRun` → `ChainEditor` → `ResultView`) only ever reads
  `output`. "Chain completes" corresponds to the SSE `done` event.

## Key decision: capture usage via the run context, not the node contract

We do **not** change `ILLMProvider.generateObject`'s return type from `T` to
`{ object, usage }`. Doing so would ripple through `SkillNode`, `BaseNode`,
`INode`, and `StepResult<T>`, and would pollute the shared node contract with
LLM-specific data that tools never produce — violating the spirit of D1 (tools
and skills share one `INode` contract).

Instead we thread a small **usage sink** (a token accumulator) through
`IRunContext`. The LLM provider reports usage to a callback; the callback feeds
the run-scoped sink; the engine reads the accumulated total when the run ends.
This keeps `INode` / `StepResult` untouched — usage is a *context* concern
(like the logger), not a node-output concern.

## Components & changes

### Section 1 — Core plumbing (`packages/core`)

1. **`IRunContext` gains a usage sink.** New interface in
   `contracts/IRunContext.ts`:
   ```ts
   export interface TokenUsage {
     promptTokens: number;
     completionTokens: number;
     totalTokens: number;
   }
   export interface IUsageSink {
     add(usage: TokenUsage): void;
     total(): number; // sum of totalTokens across all add() calls
   }
   ```
   Add `readonly usage: IUsageSink` to `IRunContext`.

2. **`UsageAccumulator`** — a trivial concrete implementation of `IUsageSink`
   (new file, e.g. `infra/llm/UsageAccumulator.ts` or `engine/UsageAccumulator.ts`).
   One fresh instance is created per run inside the ctx factory
   (`buildEngine`'s `ctxFactory`). Defaults to total 0.

3. **`ILLMProvider.generateObject` gains an optional usage callback.** Append a
   5th parameter `onUsage?: (usage: TokenUsage) => void`.
   `VercelAILLMProvider` changes `const { object }` to
   `const { object, usage }` and calls `onUsage?.(usage)` **only on the
   successful attempt** that returns. Failed fallback attempts must not call
   `onUsage` (no double counting). The AI SDK usage fields can be `NaN`/absent
   for some providers — coerce each field with `Number.isFinite(x) ? x : 0`
   before reporting, so a missing count never corrupts the total.

4. **`SkillNode.run`** passes `(u) => ctx.usage.add(u)` as the `onUsage` arg to
   `ctx.llm.generateObject(...)`. `ToolNode` is untouched (tools consume no
   tokens).

5. **`ChainEngine`** reads `ctx.usage.total()` after the step loop and:
   - includes it on `RunResult` as `totalTokens: number`;
   - persists it on the terminal `updateRun(...)` call — both the
     `"completed"` path and the `"failed"` path, so partial usage is recorded
     for runs that error partway through.

### Section 2 — Persistence

6. **New migration** `supabase/migrations/0002_runs_total_tokens.sql`:
   ```sql
   ALTER TABLE runs ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0;
   ```

7. **`RunRecord` DTO** (`contracts/dtos.ts`) gains
   `totalTokens?: number | undefined`.

8. **`IRunRepository.updateRun`** patch type widens to include `totalTokens`:
   `Partial<Pick<RunRecord, "status" | "finishedAt" | "totalTokens">>`.
   `SupabaseRunRepository.updateRun` maps `patch.totalTokens` →
   `total_tokens` column when present.

### Section 3 — Transport + UI (`apps/web`)

9. **Run route** (`app/api/chains/[id]/run/route.ts`): the `done` event payload
   gains `totalTokens: result.totalTokens`.

10. **`useChainRun`**: `DoneEvent` gains `totalTokens?: number`; the `onDone`
    callback signature becomes `(result: unknown, totalTokens?: number)`.

11. **`ChainEditor`**: store `totalTokens` in run state (extend the
    `SET_RUN_RESULT` reducer action / run-state shape). Render it near
    `ResultView` as a small muted line, e.g. **"≈ 1,240 tokens"**
    (locale-formatted with thousands separators).
    **Hide the line entirely when the total is 0** so chains with no skill
    steps don't show a meaningless "0 tokens".

## Data flow (after change)

```
generateObject() ──{object, usage}──> VercelAILLMProvider
  └─ onUsage(usage) ──> ctx.usage.add(usage)        [run-scoped UsageAccumulator]
SkillNode.run ── passes onUsage ──┘
...all steps run...
ChainEngine (end) ── ctx.usage.total() ──> RunResult.totalTokens
  └─ updateRun({ status, finishedAt, totalTokens })  [persist → runs.total_tokens]
run route ── done event { ..., totalTokens } ──> SSE
useChainRun ── onDone(output, totalTokens) ──> ChainEditor state ──> muted line by ResultView
```

## Error handling

- The sink accumulates per **successful** LLM call, so a run that fails partway
  still reports an accurate partial total. Both terminal `updateRun` paths
  (`completed` and `failed`) persist `totalTokens`.
- Providers that omit usage fields → coerced to 0 (never `NaN`).
- A chain with no skill steps → total 0 → UI line hidden.

## Testing (TDD: red → green → refactor)

- **Unit:** `UsageAccumulator` — `add()` sums `totalTokens`; `total()` starts
  at 0.
- **Provider:** update `VercelAILLMProvider.test.ts` — assert `onUsage` fires
  with the SDK-reported usage, fires **exactly once** even when an earlier
  attempt fails and the fallback succeeds, and coerces missing fields to 0.
- **Engine:** update `ChainEngine.golden.test.ts` — a fake LLM provider reports
  usage; assert `RunResult.totalTokens` equals the summed total and that
  `updateRun` was called with `totalTokens`.
- **e2e:** `resume-chain.e2e.test.ts` — assert the completed run reports a
  non-zero `totalTokens` from the cassette.

## Out of scope

- Per-step token display, prompt/completion split, cost (dollar) estimation.
- Backfilling `total_tokens` for historical runs (defaults to 0).
- Per-provider token reconciliation / accuracy guarantees beyond what the SDK
  returns.

## Files touched

**core:** `contracts/IRunContext.ts`, `contracts/dtos.ts`,
`contracts/IRepositories.ts`, new `UsageAccumulator.ts`,
`infra/llm/VercelAILLMProvider.ts`, `node/SkillNode.ts`,
`engine/ChainEngine.ts`, `di/buildEngine.ts`,
`infra/supabase/SupabaseRunRepository.ts`, plus tests.

**web:** `app/api/chains/[id]/run/route.ts`, `hooks/useChainRun.ts`,
`components/editor/ChainEditor.tsx` (+ run-state reducer/types).

**db:** `supabase/migrations/0002_runs_total_tokens.sql`.
