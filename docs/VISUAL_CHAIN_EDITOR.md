# Visual Chain Editor — Design Spec

**Date:** 2026-06-28
**Status:** Approved for planning
**Relates to:** [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md) (D16 "generative-UI deferred but architected for"; "Visual chain-builder UI" listed Out of Scope for v1 — this spec is the next increment after v1).

---

## 1. Goal

An n8n-style visual editor for an **existing** chain. The user opens a chain, sees its
steps as node cards wired together on a pan/zoom canvas, and edits the chain by selecting
and manipulating nodes: reorder, insert, remove, rewire inputs, edit literals, edit the
trigger, save back to the DB, and run it with live per-step status.

This is **edit-existing**, not build-from-blank. Creating brand-new chains on an empty
canvas is a deliberate later increment (see [§11 Out of Scope](#11-out-of-scope-for-this-spec)).

### Success criteria

By the end of M5 the user can, entirely from the browser:

1. Open `/editor/<chainId>` and see the stored Drive→extract→parse chain as wired node cards.
2. Select any node and see/edit where each of its input fields comes from.
3. Insert a registered node, remove a node, and drag to reorder steps.
4. Save the modified chain so it persists across reloads.
5. Run the chain and watch each node light up pending → running → ok/error, ending in a result.

---

## 2. Constraints (inherited from the architecture)

- **Linear execution (D5).** The engine resolves steps **linearly**. The `Ref` model is
  DAG-ready (a step can reference any earlier step), but the v1 executor runs the ordered
  list top to bottom. The editor must therefore **never produce a topology the engine can't
  run**: every `Ref` may only point at the **trigger** or a **strictly-earlier** step.
- **No node positions in the schema.** `Chain`/`Step` have no `x`/`y` fields and we are not
  adding them. The canvas computes layout from step order (auto-layout). Layout is a UI
  concern, never persisted.
- **Zod schemas live in `core`.** Node input/output contracts are Zod types in `packages/core`
  and cannot be shipped to the browser as-is. The editor learns node shapes through a server
  API that converts schemas to plain-JSON field descriptors.
- **Auth model is unchanged (D15).** New chain read/write routes reuse the existing
  `x-run-secret` shared-secret gate. No new auth mechanism.
- **`core` stays framework-agnostic.** New introspection logic added to `core` must not pull
  in Next/Supabase. It only reads Zod schemas already present on nodes.

---

## 3. Existing seams this builds on (verified against the codebase)

| Seam | Location | Used for |
|------|----------|----------|
| `Chain`/`Step`/`Ref`/`ChainSchema` DTOs | [`packages/core/src/contracts/dtos.ts`](../../../packages/core/src/contracts/dtos.ts) | The working document the editor mutates; PUT validation. |
| `INode` (`id`, `kind`, `description`, `inputSchema`, `outputSchema`) | [`packages/core/src/contracts/INode.ts`](../../../packages/core/src/contracts/INode.ts) | Source of the node catalog. |
| `NodeRegistry.list()` | [`packages/core/src/registry/NodeRegistry.ts`](../../../packages/core/src/registry/NodeRegistry.ts) | Enumerate registered nodes for the palette. |
| `IChainRepository.findById` / `save` | [`packages/core/src/contracts/IRepositories.ts`](../../../packages/core/src/contracts/IRepositories.ts) | Backing the chain GET/PUT routes. |
| `buildEngine({ ... })` → `EngineBundle` | [`packages/core/src/index.ts`](../../../packages/core/src/index.ts) | Composition root; exposes engine + repos + registry to routes. |
| Existing run route + SSE protocol | [`apps/web/src/app/api/chains/[id]/run/route.ts`](../../../apps/web/src/app/api/chains/[id]/run/route.ts) | Reused unchanged for M5; SSE event shape (`step`/`done`/`error`) is the contract. |
| Existing SSE reader logic | [`apps/web/src/app/page.tsx`](../../../apps/web/src/app/page.tsx) | Extracted into a shared `useChainRun` hook for M5. |
| `chains.steps` JSONB column | [`supabase/migrations/0001_initial_schema.sql`](../../../supabase/migrations/0001_initial_schema.sql) | Persistence target; **no migration needed**. |

> **Gap to fill:** `buildEngine` currently returns the engine for the run route. The editor
> routes need the **chain repository** and the **node registry** too. The plan must confirm
> `EngineBundle` exposes (or is extended to expose) `chainRepository` and `registry`; if not,
> that is a small, additive change to `buildEngine` — no behavior change to existing callers.

---

## 4. New server seams (in `apps/web`, plus one helper in `core`)

All routes reuse the `x-run-secret` gate (D15). All are App Router route handlers.

### 4.1 `GET /api/nodes` — node catalog (dynamic)

Walks `registry.list()` and returns a JSON descriptor per node so the palette and inspector
reflect **whatever is registered** — add a node in `core`, it appears automatically (preserves
the architecture's Open/Closed promise into the UI).

```ts
// Response shape
interface NodeFieldDescriptor {
  name: string;                 // input/output field name
  type: string;                 // human-readable: "string" | "number" | "BlobHandle" | "object" | ...
  required: boolean;
}
interface NodeCatalogEntry {
  id: string;                   // e.g. "drive.download_file"
  kind: "tool" | "skill";
  description?: string;
  inputFields: NodeFieldDescriptor[];
  outputFields: NodeFieldDescriptor[];
}
// GET /api/nodes -> { nodes: NodeCatalogEntry[] }
```

The Zod→descriptor conversion is a **new pure helper in `core`**:

```ts
// packages/core/src/registry/describeNode.ts
export function describeNode(node: NodeMeta & {
  inputSchema: ZodType; outputSchema: ZodType;
}): NodeCatalogEntry;
```

It introspects the top-level shape of a Zod object schema (field names, whether optional,
a best-effort type label). **Scope of introspection:** top-level fields only; nested object
fields collapse to type `"object"`. This is enough for the inspector to list the input fields
a step must wire. Non-object schemas (rare) yield a single field named `value`.

### 4.2 `GET /api/chains/[id]` — read a chain

`chainRepository.findById(id)` → `200 { chain }` or `404 { error: "Chain not found" }`.

### 4.3 `PUT /api/chains/[id]` — save a chain

Body is a full `Chain`. Validate with `ChainSchema` (`safeParse`); on failure return
`400 { error, issues }`. On success `chainRepository.save(chain)` → `200 { ok: true }`.
The `id` in the path must match the body's `id` (else `400`).

### 4.4 Reused: `POST /api/chains/[id]/run`

Unchanged. M5 consumes its existing SSE stream.

---

## 5. Client structure

New route: `apps/web/src/app/editor/[chainId]/page.tsx` (client component shell).

Components under `apps/web/src/components/editor/`:

| Component | Responsibility | Depends on |
|-----------|----------------|-----------|
| `ChainEditor` | Top-level shell; wires hook → panels → canvas. | `useChainEditor` |
| `ChainCanvas` | Pan/zoom surface. Renders trigger pseudo-node + a `NodeCard` per step, positioned by auto-layout (left→right). Owns viewport transform. | working `Chain` |
| `NodeCard` | One step. Header (nodeId + kind badge), input ports (left), output ports (right), selection highlight, status ring (M5). | catalog entry + step |
| `WireLayer` | SVG layer drawing a bezier wire from each input port to its `Ref` source port (trigger or earlier step's output). Dangling/invalid refs drawn red. | working `Chain` + port geometry |
| `NodePalette` | List of catalog nodes; click/drag to insert. | `GET /api/nodes` |
| `NodeInspector` | Side panel for selected step. Per input field: a `RefEditor`. | selected step + catalog |
| `RefEditor` | Single field's source: radio (Trigger / Prior step / Literal) → path picker or literal input. Only offers strictly-earlier steps. | step index + catalog |
| `TriggerPanel` | Edits the trigger payload object used for runs (JSON/key-value form). | trigger state |
| `Toolbar` | Save (disabled unless dirty & valid), Run, zoom in/out/fit. | hook |

### State: `useChainEditor` hook

Single client-side store. Holds:

```ts
{
  chain: Chain;                       // the working document (mutated locally)
  catalog: NodeCatalogEntry[];        // from /api/nodes
  selectedStepId: string | null;
  dirty: boolean;
  validation: ValidationState;        // per-step + per-ref problems
  trigger: Record<string, unknown>;   // run payload (M4/M5)
  run: { status: Record<stepId, "pending"|"running"|"ok"|"error">, result, error }; // M5
}
```

All mutations are **reducer-style actions** — pure functions `(chain, action) → chain` — so
they are unit-testable without the DOM:

- `reorderStep(stepId, toIndex)`
- `insertStep(nodeId, atIndex)` — generates a fresh `stepId`, seeds `inputMapping` with
  empty/placeholder refs for each required input field.
- `removeStep(stepId)`
- `setRef(stepId, fieldName, ref)`
- `setTrigger(payload)`

After every structural action the store **re-runs validation** (see §6).

---

## 6. Linear-validity & wiring rules

The editor enforces engine-runnable topology at edit time:

1. **Refs point backward only.** A step at index *i* may have `Ref.from = "trigger"` or
   `Ref.from = <stepId at index < i>`. The `RefEditor`'s "prior step" dropdown only lists
   earlier steps. The trigger pseudo-node sits at the far left.
2. **Reordering re-validates.** Moving a step earlier can orphan a `Ref` that pointed at a
   step now positioned after it. Such refs are flagged: the wire renders **red**, the node
   card shows a warning, and **Save is blocked** until every ref is valid (re-pointed or set
   to a literal).
3. **Inserted steps start incomplete-but-valid.** Required input fields with no chosen source
   are flagged "needs wiring" (not an error that crashes — a validation warning that blocks
   Save), so the user is guided to complete them.
4. **Path picker is descriptor-driven.** When a ref points at an earlier step, the `path`
   options come from that step's node's `outputFields` (from the catalog). Trigger refs allow
   a free-text path (the trigger schema is open in v1). Example from the v1 chain: `s2`
   (`document.extract_text`) takes a **flat `BlobHandle`** input (`storageRef`, `mime`, `size`,
   `sha256`), and each is wired to the matching field in `s1`'s `outputFields` — the picker
   offers exactly those four output fields, so this case needs no special handling.

These rules are the UI-side mirror of the engine's inlined linear type-compat check (D12).
The editor does **not** re-implement Zod type compatibility; it enforces *ordering* and
*field existence*, and surfaces engine validation errors at run time (M5) for type mismatches.

---

## 7. Data flow

**Load** (`/editor/[chainId]` mounts):
`GET /api/chains/[id]` + `GET /api/nodes` in parallel → hydrate `useChainEditor`
(`chain`, `catalog`). Render canvas from `chain`.

**Edit:** UI dispatches a reducer action → working `chain` mutates in memory → canvas + wires
re-render → validation recomputes → `dirty = true`. **Nothing hits the server.**

**Save:** `PUT /api/chains/[id]` with the working `chain`. On `200`, `dirty = false`. On
`400`, show the validation issues inline (should be rare — client already validated shape).

**Run (M5):** `useChainRun` (extracted from today's `page.tsx`) POSTs the trigger payload to
the existing run route and reads the SSE stream. Each `step` event maps to a `NodeCard` status
by `stepId`; `done` populates the result; `error` surfaces the message. Run uses the
**last-saved** chain on the server — so the UI prompts to Save first if `dirty`.

---

## 8. Milestones (each independently testable on the UI)

> Ordering front-loads visible payoff and defers the riskiest integration (SSE run streaming)
> to last. Each milestone ends at a point where the user can open the page and see/do something.

### M1 — Read-only canvas
- **Build:** `describeNode` helper + `GET /api/nodes`; `GET /api/chains/[id]`; `/editor/[chainId]`
  page; `ChainCanvas`, `NodeCard`, `WireLayer`, trigger pseudo-node; auto-layout; pan/zoom.
- **Testable:** Open `/editor/<resume-chain-id>` → see three wired node cards (download → extract
  → parse) plus the trigger, laid out left→right, pannable and zoomable. No editing yet.

### M2 — Node inspector (read → edit literals & refs)
- **Build:** `NodeInspector`, `RefEditor`; `setRef` action; per-field source switching
  (trigger / prior step / literal); descriptor-driven path picker; wires re-render on change.
- **Testable:** Click a node → panel lists its input fields with current sources. Change a
  ref or a literal → the wire on the canvas updates immediately. (Still in-memory; no save.)

### M3 — Structural editing
- **Build:** `NodePalette` (from `/api/nodes`); `insertStep`, `removeStep`, `reorderStep`
  actions; drag-to-reorder; insert-from-palette; remove control on the node card; §6 validity
  rules + red dangling-wire rendering.
- **Testable:** Drag a node to reorder; add a node from the palette; delete a node. Illegal
  wiring (backward-only violations) shows red and warns.

### M4 — Persistence
- **Build:** `PUT /api/chains/[id]`; `Toolbar` Save with dirty/valid gating; `TriggerPanel`;
  load/save round-trip.
- **Testable:** Make edits → Save → reload the page → edits persist. Save is disabled while
  invalid; enabled once wiring is complete.

### M5 — Run on canvas
- **Build:** Extract `useChainRun` from `page.tsx`; Toolbar Run; map SSE `step` events to
  per-node status rings; result panel (reuse `ResultView`); "Save first" prompt when dirty.
- **Testable:** Click Run → nodes light up pending→running→ok/error in order → result renders.

---

## 9. Testing strategy

- **`describeNode` (core, Vitest):** given each registered node, asserts the expected field
  descriptors (names, required flags, type labels), including the `BlobHandle`-flat-input case
  for `document.extract_text` and the non-object fallback.
- **Reducer actions (`useChainEditor`, Vitest):** pure `(chain, action) → chain` tests —
  reorder produces correct order; insert seeds placeholder refs for required fields; remove
  drops the step; setRef updates the right field; reorder that orphans a ref is flagged invalid.
- **Validation:** backward-only rule, dangling-ref detection, save-gating predicate.
- **API routes:** `GET /api/nodes` returns catalog; `GET /api/chains/[id]` 200/404;
  `PUT` validates with `ChainSchema` (400 on bad body, id-mismatch 400, 200 on save) with the
  auth gate honored (401 without secret).
- **Per-milestone manual UI check:** the "Testable" line of each milestone is the acceptance
  check for that slice.

No end-to-end browser automation is required for this spec; the run path is already covered by
the existing v1 e2e, and M5 reuses that same engine + SSE contract.

---

## 10. Error handling

- **Load failures** (chain 404, network): the editor shows an error state, not a blank canvas.
- **Save validation** (`PUT` 400): issues rendered inline against the offending step/field.
- **Dangling refs:** non-crashing validation warnings; block Save and Run; rendered red.
- **Run errors (M5):** the existing `error`/`done(ok:false)` SSE events map to a per-node error
  ring + a message panel; the redaction boundary (D8) already guarantees safe error shapes.
- **Auth:** missing/invalid `x-run-secret` → 401 from the new routes, surfaced as a clear UI
  message (matches the run route's behavior).

---

## 11. Out of scope for this spec

- **Build-from-blank** new chains on an empty canvas (separate later increment).
- **Creating/editing node implementations** — nodes come from the registry only.
- **True DAG topologies** — branching/fan-in/cycles. The Ref model stays DAG-ready in data,
  but the editor enforces linear-only until the engine supports more (D5).
- **Persisted node positions / freeform x-y layout** — layout stays auto-computed.
- **Multi-chain list/management screen** — the editor opens a known `chainId`.
- **Generative UI result rendering** — M5 reuses the existing `ResultView`.
- **Nested-field deep wiring** — refs target top-level output fields; nested objects collapse
  to `"object"` in the catalog (revisit if a node needs deep paths).
```
