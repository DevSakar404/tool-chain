# Design: Trigger form + historically-paced run progress bar

**Date:** 2026-07-02
**Status:** Implemented

## Goal

Two related editor UX problems, fixed together because the second builds directly
on the first's UI real estate:

1. **Trigger input was a raw JSON textarea.** A user could (and did) send
   `{ "fieldId": "..." }` instead of `{ "fileId": "..." }` — a typo the engine
   only caught at run time via `InputResolver`'s "Trigger path not found" error.
   Replace it with a generated form: one labeled input per trigger field the
   chain actually references, so field names can't be mistyped.
2. **Run progress had no sense of pace.** The existing per-step status rings
   only ever reflected real SSE events, so a slow step (e.g. an LLM call) left
   the UI looking stalled with no feedback until it finished. Show progress
   that advances smoothly based on **how long this chain's steps have taken
   historically**, while never fabricating a false "done".

Scope confirmed with the user:
- Trigger fields are discovered from the chain definition, not hand-declared.
- Progress pacing is server-computed from **real persisted run history**
  (not client-side/localStorage), averaged over the most recent runs.
- The paced/estimated timer is for the *in-flight* animation only — the
  number shown at completion is always the actual measured elapsed time,
  whether the run finished faster or slower than history.
- Dots only ever show real completion/error state; pacing may show a step as
  "running" early to feel alive, but never shows a fabricated checkmark.

## Part 1 — Trigger form

### Background

`TriggerPanel` (`apps/web/src/components/editor/TriggerPanel.tsx`) rendered a
`<textarea>` bound to `JSON.parse`/`JSON.stringify` of `state.trigger`. Nothing
constrained the keys typed there against what the chain's steps actually read
via `{ from: "trigger", path: "..." }` refs.

### Key decision: derive fields from `Ref.from === "trigger"`, not a declared schema

The trigger has no declared Zod schema in v1 (`docs/VISUAL_CHAIN_EDITOR.md` §6:
"the trigger schema is open"). Rather than adding one, `TriggerPanel` scans
every step's `inputMapping` for refs where `from === "trigger"` and collects
the distinct `path` values — that set **is** the chain's real trigger contract,
because it's exactly what `InputResolver.resolve()` will look up at run time.
Type per field (`"string" | "number"`) is inferred from the *consuming* step's
`NodeCatalogEntry.inputFields[name].type`, defaulting to `"string"`.

### Changes

- **`TriggerPanel.tsx`** — replaced the textarea with a generated form: one
  labeled `<input>` per derived field, coercing on change (`Number(...)` for
  numeric fields, raw string otherwise). Added a second **Run** button next to
  the form (mirrors `Toolbar`'s enable predicate: `!dirty && valid && !running
  && !saving`) so running doesn't require scrolling back to the toolbar.
- **`ChainEditor.tsx`** — passes `chain`, `catalog`, `onRun`, `canRun`,
  `running` into `TriggerPanel`.

### Root-cause fix found along the way

While verifying the form, per-step status rings (`NodeCard`, and now the
progress bar) never lit up during a real run — `run/route.ts` was forwarding
the engine's raw `StepProgressEvent` (`{ event: "step:running", stepId,
nodeId }` / `{ event: "step:done", stepRun }`) directly as the SSE `step`
payload, but `useChainRun.ts` expects a flat `{ stepId, status }`. Fixed by
mapping the event shape once, at the SSE boundary in `run/route.ts`, rather
than patching either the engine's event contract (used elsewhere) or the
client interface (already the right shape) — one place, all consumers fixed.

## Part 2 — Historically-paced progress bar

### Background — what "average of previous runs" requires

`StepRunRecord` (`contracts/dtos.ts`) already carries `startedAt`/`finishedAt`
per step, persisted to the `step_runs` table. `stepId` (e.g. `"s1"`, `"s2"`) is
a **stable per-chain-definition slot**, not a fresh UUID per run — so grouping
`finished_at - started_at` by `stepId` across a chain's past runs yields a
valid per-step historical average. But `IRunRepository` only exposed
create/update methods — no read path existed for past runs at all.

### Key decision: a narrow read method, not a general run-history API

Rather than building a general "list runs" API, `IRunRepository` gains exactly
the one read shape the feature needs:

```ts
export interface StepDuration {
  stepId: string;
  durationMs: number;
}

// on IRunRepository:
listRecentStepDurations(chainId: string, limit: number): Promise<StepDuration[]>;
```

This returns flat `(stepId, durationMs)` pairs — not full `StepRunRecord`s —
because averaging is all the caller does with them; shipping `input`/`output`
JSONB blobs over this path would be wasted work for a metric endpoint.

### Key decision: average and cache-friendliness live server-side

A new route, `GET /api/chains/[id]/step-averages`, calls
`listRecentStepDurations(chainId, 20)`, groups by `stepId`, and returns
`{ averageMsByStepId: Record<string, number> }`. The client never sees raw
run rows — just the number it needs to pace with. Fetched once per editor
page load, in parallel with the existing chain/catalog fetches
(`Promise.all` in `app/editor/[chainId]/page.tsx`). A fetch failure or a chain
with zero history resolves to `{}` rather than surfacing a `loadError` — this
data is a pacing hint, not something the editor's correctness depends on.

### Key decision: real status always overrides paced status

The bar (`RunProgressBar.tsx`) computes, per step, an **expected start time**
— the cumulative sum of prior steps' historical averages (or a 2s default for
a step with no history yet, so a never-run chain still paces sensibly).
While a run is active, a step with no real status yet is shown as "running"
(pulsing ring) once the elapsed timer crosses its expected start — this is
what makes progress feel continuous instead of stalled on a slow step. The
moment a real SSE status (`ok`/`error`) arrives for that step, it **always**
wins over the paced guess:

```ts
function pacedStatus(real, expectedStart, elapsedMs, active) {
  if (real) return real;                                  // ground truth wins
  if (active && elapsedMs >= expectedStart) return "running"; // paced guess
  return real; // undefined — still pending
}
```

A dot can look like it's "running" ahead of the real event; it can never show
a checkmark or error the run hasn't actually reached. This is the guardrail
against "consistent progress" becoming "lying about progress."

### Key decision: the completion number is always the real elapsed time

The header timer (`elapsedMs`, ticking every 100ms via `setInterval`) starts
when `run.active` becomes true and simply stops updating when it becomes
false — so "Done" / "Failed" always displays the actual wall-clock duration of
that specific run, never a value clamped to or replaced by the historical
average. A run that finishes in 3s when the average is 20s shows 3s; a run
that takes 40s shows 40s. The average only shapes the *pacing of the dots*
while running, never the final number.

## Data flow

```
step_runs (started_at, finished_at, step_id)  [existing table, no migration]
  └─ SupabaseRunRepository.listRecentStepDurations(chainId, 20)
       └─ GET /api/chains/[id]/step-averages  → { averageMsByStepId }
            └─ editor page load (parallel with chain + catalog fetch)
                 └─ useChainEditor state.stepAverages
                      └─ RunProgressBar: expectedStartTimes(steps, stepAverages)
                           ├─ paces "running" look ahead of real SSE events
                           └─ real run.stepStatuses always overrides once it arrives
```

## Components & changes

### `packages/core`

- **`contracts/IRepositories.ts`** — `IRunRepository.listRecentStepDurations`
  + `StepDuration` type.
- **`infra/supabase/SupabaseRunRepository.ts`** — implements it as two
  queries: recent run ids for the chain (`runs` table, ordered by
  `created_at desc`, limited), then their step durations
  (`step_runs` table, `.in("run_id", runIds)`).
- **`infra/supabase/SupabaseTypes.ts`** — the hand-rolled `SupabaseQueryBuilder`
  structural type had no list-query support (`order`/`limit`/`in`, or an
  array-shaped `data`) because nothing had needed one before. Widened to
  support both.
- **`di/buildEngine.ts`** — `EngineBundle` gains `runRepository` (was created
  internally but never exposed — routes need it directly, the same gap the
  original `VISUAL_CHAIN_EDITOR.md` spec flagged for `chainRepository`).
- Test fakes in `ChainEngine.golden.test.ts` and `resume-chain.e2e.test.ts`
  updated with a `listRecentStepDurations` stub.

### `apps/web`

- **New route** `app/api/chains/[id]/step-averages/route.ts` — auth-gated like
  its siblings (`x-run-secret`), groups durations by `stepId`, returns
  rounded-ms averages.
- **`app/editor/[chainId]/page.tsx`** — `fetchStepAverages` added to the
  parallel load; swallows errors to `{}`.
- **`types/editor.ts`** — `EditorState.stepAverages: Record<string, number>`.
- **`hooks/useChainEditor.ts`** — `LOAD` action carries optional
  `stepAverages` (defaults to `{}` so existing reducer tests didn't need to
  change).
- **`components/editor/RunProgressBar.tsx`** (replaces the short-lived
  `RunProgressModal.tsx`, removed after review — progress renders inline
  above the trigger form, no backdrop/blur/dismiss) — step dots + connecting
  lines, paced per `pacedStatus`/`expectedStartTimes`, header shows live
  elapsed timer while running and final elapsed time once done.
- **`components/editor/ChainEditor.tsx`** — renders `RunProgressBar` directly
  above `TriggerPanel` once a run has started or has a result/error to show.

## Error handling

- Missing/failed `step-averages` fetch → `{}` → every step falls back to the
  2s default pacing; never blocks the editor from loading.
- A step with zero history still paces (via the default), rather than never
  showing "running" until the real event arrives.
- Real `error` status on any step immediately shows the red ✕ and freezes
  pacing for that run — a paced guess is never shown once ground truth exists.

## Testing

- **Unit (`apps/web/src/__tests__/components/RunProgressBar.test.ts`):**
  `expectedStartTimes` cumulates historical averages and falls back to the
  default for unseen steps; `pacedStatus` prefers real status over pacing,
  paces "running" once elapsed crosses the expected start, and never paces
  when the run isn't active.
- **Existing suites unaffected:** `ChainEngine.golden.test.ts`,
  `resume-chain.e2e.test.ts`, `useChainEditor.reducers.test.ts` all pass with
  the updated fakes / optional `stepAverages`.
- **Manual (browser preview):** verified the derived trigger form renders and
  runs correctly; verified real per-step status (ok/error) always overrides
  any paced guess, including a live 401 from an expired Google OAuth token
  during manual testing — the bar showed the real error immediately rather
  than a fabricated success.

## Out of scope

- Outlier filtering / trimmed mean for the historical average — a single slow
  run skews pacing until it rolls off the most-recent-20 window. Flagged as a
  known limitation, not fixed here.
- A general "list past runs for a chain" API — only the narrow
  `listRecentStepDurations` shape the feature needs.
- Persisting or exposing per-run duration history in the UI (e.g. a run log
  view) — this spec only feeds the live progress bar.
- Nested/dotted trigger field paths in the generated form — top-level fields
  only, matching the editor's existing output-field convention.

## Files touched

**core:** `contracts/IRepositories.ts`, `infra/supabase/SupabaseRunRepository.ts`,
`infra/supabase/SupabaseTypes.ts`, `di/buildEngine.ts`, plus
`ChainEngine.golden.test.ts` and `resume-chain.e2e.test.ts` fakes.

**web:** `components/editor/TriggerPanel.tsx`,
`components/editor/RunProgressBar.tsx` (new; replaces the removed
`RunProgressModal.tsx`), `components/editor/ChainEditor.tsx`,
`app/api/chains/[id]/run/route.ts` (SSE event-shape fix),
`app/api/chains/[id]/step-averages/route.ts` (new),
`app/editor/[chainId]/page.tsx`, `types/editor.ts`, `hooks/useChainEditor.ts`,
new test `__tests__/components/RunProgressBar.test.ts`.

**db:** none — no migration needed; `step_runs.started_at`/`finished_at` and
the existing `runs(chain_id)` / `step_runs(run_id)` indexes were sufficient.
