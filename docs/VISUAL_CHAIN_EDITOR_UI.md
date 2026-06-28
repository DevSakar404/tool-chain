# Visual Chain Editor — UI / UX Design

**Date:** 2026-06-28
**Status:** Design language reference
**Companion to:** [`VISUAL_CHAIN_EDITOR.md`](./VISUAL_CHAIN_EDITOR.md) (functional spec — *what* the editor does).
This doc covers **how it looks and feels**, taking inspiration from n8n's editor.

> **Principle.** Built on the existing shadcn token system
> ([`apps/web/src/app/globals.css`](../apps/web/src/app/globals.css)) — no parallel palette.
> Everything below maps to those CSS variables so light/dark mode and the existing app stay
> consistent. n8n is the *inspiration* for layout and interaction patterns, not a pixel copy.

---

## 1. What we borrow from n8n (and what we don't)

| Borrow (the good parts) | Why |
|--------------------------|-----|
| **Curved bezier connectors** between node ports | Reads as "flow"; far calmer than right-angle wires. |
| **Rounded node cards** with a colored left rail + icon block | Instantly communicates node *kind* at a glance. |
| **Dotted canvas** with pan/zoom | Spatial, infinite, signals "this is a workspace not a list." |
| **Right-side parameter drawer** on select | Keeps the canvas clean; details on demand. |
| **Distinct execute/run affordance** (green) | The "go" action is unmistakable and separate from edit. |
| **Port handles** that highlight on hover/drag | Makes wiring feel direct and physical. |
| **Live execution state** painted onto nodes | Running a chain is a visual event, not a log. |

| Skip (n8n quirks we don't want) | Why |
|----------------------------------|-----|
| Dense top toolbar with dozens of icons | We have 3 actions (Save, Run, zoom). Keep it sparse. |
| n8n's exact brand colors | We use our own tokens for theme consistency. |
| Freeform drag-anywhere positioning | Our layout is auto-computed (linear backbone). |
| Sticky notes, pinning, sub-workflows | Out of scope; visual noise for v1. |

**Aesthetic North Star:** *calm, precise, and legible.* Generous whitespace, one accent color
doing the heavy lifting, soft shadows over hard borders, motion that confirms rather than
decorates. It should feel closer to Linear's restraint than to a busy IDE.

---

## 2. Design tokens

All colors reference existing shadcn HSL vars. New semantic tokens are **derived**, not new
brand colors — add them to `globals.css` as listed.

### 2.1 Palette (semantic)

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `--canvas-bg` | `210 40% 98%` (near-white) | `222 47% 7%` (near-black slate) | Canvas backdrop |
| `--canvas-dot` | `214 31% 88%` | `217 33% 20%` | Dot grid |
| `--node-surface` | `var(--card)` | `var(--card)` | Node card body |
| `--node-border` | `var(--border)` | `var(--border)` | Node card outline |
| `--wire` | `215 16% 60%` | `215 20% 50%` | Default connector |
| `--wire-active` | `var(--accent-flow)` | `var(--accent-flow)` | Connector during/after run |
| `--wire-invalid` | `var(--destructive)` | `var(--destructive)` | Dangling/backward-violating ref |
| `--accent-flow` | `211 100% 50%` (azure) | `211 100% 60%` | Primary accent: selection, ports, links |
| `--accent-run` | `142 71% 45%` (green) | `142 64% 48%` | Run/execute action + success |

> **One accent rule.** `--accent-flow` (azure) is *the* interactive accent — selection rings,
> active ports, focused wires, primary buttons. `--accent-run` (green) is reserved **only** for
> the run/execute action and the success state, so "go" always reads as green and nothing else
> competes with it.

### 2.2 Node-kind accents

The left rail + icon tint encode `kind` (from the node catalog):

| Kind | Accent (light / dark) | Icon motif |
|------|------------------------|-----------|
| `tool` (deterministic I/O) | `199 89% 48%` / `199 89% 55%` (cyan) | wrench / plug |
| `skill` (LLM reasoning) | `262 83% 58%` / `262 83% 66%` (violet) | sparkle / brain |
| `trigger` (pseudo-node) | `215 16% 47%` / `215 20% 65%` (slate) | lightning / play |

Two kinds today, but the rail is data-driven so a third kind drops in without redesign.

### 2.3 Type, spacing, elevation

- **Font:** inherit app font (system/Geist stack). **Mono** (`ui-monospace`) for `nodeId`,
  field names, paths, and literal values — anything that is "code."
- **Scale:** node title `text-sm font-semibold`; field labels `text-xs`; ports/paths
  `text-[11px] font-mono`. Canvas chrome stays small and quiet.
- **Spacing rhythm:** 4px base. Node card padding `12px`; port row height `28px`; drawer
  padding `16px`.
- **Radius:** node cards `var(--radius)` (8px) → feels soft; ports fully round; drawer `0`
  (flush to edge) on the docked side, `var(--radius)` on free corners.
- **Elevation:** nodes use a **soft shadow**, not a heavy border —
  `0 1px 2px rgb(0 0 0 / 0.06), 0 4px 12px rgb(0 0 0 / 0.04)`. Selected node lifts:
  `0 0 0 2px hsl(var(--accent-flow)) , 0 8px 24px rgb(0 0 0 / 0.10)`.

---

## 3. Canvas

```
┌──────────────────────────────────────────────────────────────────────┐
│  ◀ Resume Chain          [ unsaved • ]            ⟳ Save    ▶ Run       │  ← top bar (h-14)
├───────────────┬──────────────────────────────────────────────────────┤
│               │  · · · · · · · · · · · · · · · · · · · · · · · · · ·   │
│   PALETTE     │  ┌────────┐      ┌─────────┐      ┌─────────┐          │
│   (M3)        │  │trigger │─────▶│ s1      │─────▶│ s2      │─ ─ ▶ …    │
│               │  └────────┘      │download │      │extract  │          │
│   ▸ drive.    │                  └─────────┘      └─────────┘          │
│   ▸ document. │  · · · · · · · · · · · · · · · · · · · · · · · · · ·   │
│   ▸ resume.   │                                       ⊕ ⊖ ⤢  (zoom)    │
└───────────────┴──────────────────────────────────────────────────────┘
                                                         ▲ inspector drawer
                                                           slides in from right
```

- **Backdrop:** `--canvas-bg` with a **dot grid** (`radial-gradient` of `--canvas-dot`, 1px
  dots on a 20px lattice). Dots fade slightly as you zoom out (opacity tied to scale).
- **Pan:** click-drag empty space (grab → grabbing cursor) or trackpad two-finger. **Zoom:**
  scroll/pinch, clamped `0.4×–2×`. Zoom controls bottom-right: `⊕ ⊖` and `⤢ fit-to-view`.
- **Auto-layout:** trigger pseudo-node anchored left; steps flow left→right in order, fixed
  horizontal gap (`120px`), vertically centered. Re-layout animates (200ms ease) when steps
  reorder so the change is legible.
- **Empty/error states:** load failure → centered card with message + retry (never a blank
  void). A chain with one step still shows the trigger → step wire.

---

## 4. Node card anatomy

```
        ┌─┬───────────────────────────────┐
 input  │▌│  ◇ document.extract_text   ⋮   │   ← header: kind rail (▌), icon (◇),
 ports ●┤▌│  TOOL                          │     nodeId (mono), kebab menu (⋮)
       ●┤▌│ ───────────────────────────── │
       ●┤▌│  storageRef   ◀ s1.storageRef │   ← input field rows (M2):
       ●┤▌│  mime         ◀ s1.mime       │     label + current source chip
        │ │  size         ◀ s1.size       │
        │ │  sha256       ◀ s1.sha256     │
        │ └───────────────────────────────┘● output port (right)
        └─ status ring (M5) wraps the whole card
```

- **Kind rail:** a 4px left bar in the kind accent (`tool`=cyan, `skill`=violet). The icon
  block sits just inside, tinted to match. This is the fastest "what kind of node" signal.
- **Header:** `nodeId` in mono `text-sm font-semibold`; a small uppercase `text-[10px]` kind
  badge (`TOOL` / `SKILL`); kebab (`⋮`) → Remove (M3), with a confirm for destructive delete.
- **Body — input field rows (M2):** one row per input field from the catalog. Left: field
  name (mono). Right: a **source chip** showing the current `Ref`:
  - Trigger ref → `◀ trigger.fileId` (slate chip)
  - Step ref → `◀ s1.storageRef` (azure chip)
  - Literal → `= "value"` (neutral chip, value truncated)
  - Unwired required field → `needs input` (amber, dashed border)
  Clicking a row (or the node) opens the inspector focused on that field.
- **Ports:** small round handles. **Input ports** on the left edge, one per input field, vertically
  aligned with its row. **Output port** single, right-center (the step's whole output object;
  the *path* into it is chosen by downstream refs, not by multiple output ports — keeps cards
  simple and matches the linear model). Ports glow `--accent-flow` on hover.
- **Selection:** azure 2px ring + lift shadow (§2.3). Only one node selected at a time.
- **Run states (M5)** — the status ring around the card:
  - `pending` → quiet dashed slate ring
  - `running` → animated azure ring (slow pulse / rotating dash)
  - `ok` → solid green (`--accent-run`) ring, brief check pip
  - `error` → solid `--destructive` ring + small alert pip; clicking shows the message

---

## 5. Connectors (wires)

- **Shape:** horizontal cubic bezier from the source's right port to the target's left port —
  control points pulled horizontally so wires bow gently (n8n-style), never cross at hard angles.
- **Resting:** `--wire`, 2px, slightly translucent so overlapping wires read as depth.
- **Hover/related to selection:** the wires touching the selected node brighten to
  `--accent-flow` and thicken to 2.5px; unrelated wires dim — so selecting a node reveals its
  data lineage.
- **Invalid (backward-violating / dangling ref):** `--wire-invalid`, dashed, with a small ⚠ at
  the midpoint. Blocks Save & Run (per functional spec §6).
- **Run animation (M5):** as each step goes `running`, its **incoming** wire animates a flowing
  dash in `--accent-run`; once `ok`, the wire settles to a solid faint green. This makes
  execution legible as a moving front across the canvas.
- **Trigger wire:** from the trigger pseudo-node to the first step that references it; same
  styling, slate-tinted at rest.

---

## 6. Inspector drawer (M2)

Slides in from the right (`360px`, full height under the top bar), over the canvas with a soft
left shadow — canvas stays visible and dims slightly (`bg-foreground/5` scrim) so context isn't lost.

```
┌───────────────────────────────┐
│  ◇ document.extract_text    ✕ │  header: icon + nodeId + close
│  TOOL · extracts text…         │  kind + description (from catalog)
├───────────────────────────────┤
│  INPUT MAPPING                 │
│                                │
│  storageRef          string    │  field name (mono) + type label
│  ┌───────────────────────────┐ │
│  │ ○ Trigger ● Step ○ Literal│ │  source switcher (segmented)
│  └───────────────────────────┘ │
│  Step  [ s1 ▾ ]  Path [ storageRef ▾ ]   ← descriptor-driven pickers
│                                │
│  mime                string    │
│  …                             │
└───────────────────────────────┘
```

- **Header:** node icon (kind-tinted), `nodeId`, one-line description (from catalog),
  close `✕`. Esc or click-scrim also closes.
- **Per field (the `RefEditor`):**
  - **Type label** on the right (`string`, `number`, `BlobHandle`, `object`…) from the catalog.
  - **Source switcher:** a shadcn segmented control — Trigger / Step / Literal.
  - **Step source** → two selects: *Step* (only strictly-earlier steps; later steps disabled
    with a tooltip "must come before this node") and *Path* (that step's output fields).
  - **Trigger source** → a text input for the path (trigger schema is open in v1).
  - **Literal source** → a typed input (text/number/JSON) sized to the field type.
  - Live: editing a ref repaints the wire on the canvas instantly.
- **Validation inline:** a field that's unwired/invalid shows an amber/red helper line under it.

---

## 7. Palette (M3)

Left rail (`260px`), collapsible. Grouped by node-id namespace (`drive.*`, `document.*`,
`resume.*`). Each entry is a mini node chip: kind-tinted icon, `nodeId` (mono), description on
hover. **Insert** by drag-onto-canvas (a ghost insertion marker shows where it lands in the
sequence) or click → inserts after the selected node (or at the end). Search box at top filters
the list. The palette reads from `GET /api/nodes`, so it always mirrors what's registered.

---

## 8. Top bar & actions

`h-14`, flush, subtle bottom border. Left: back chevron + chain name (inline-editable later;
read-only for now) + a **dirty pill** (`unsaved •` in amber when `dirty`). Right, in order:

- **Save** — secondary button; **disabled** unless `dirty && valid`; shows a tooltip listing
  blocking issues when disabled. Spinner while saving; brief check on success.
- **Run** — primary **green** (`--accent-run`) button with a ▶ glyph. If `dirty`, clicking
  prompts "Save changes before running?" (Save & Run / Cancel) since runs use the saved chain.
  During a run it becomes a **Running…** state with a stop affordance.

Keep this bar sparse — these are the only global actions. Zoom lives on the canvas, node
actions live on the card/drawer.

---

## 9. Motion & micro-interactions

Motion confirms state changes; it never blocks. Durations short (`150–220ms`), easing
`cubic-bezier(0.2, 0, 0, 1)`.

| Interaction | Motion |
|-------------|--------|
| Select node | ring + lift fade-in (150ms); related wires brighten, others dim |
| Open/close drawer | slide + scrim fade (200ms) |
| Reorder step | cards animate to new auto-layout positions (200ms) |
| Insert/remove node | new card scales up from 0.96→1 / removed card fades+collapses |
| Rewire ref | wire path tweens to the new endpoint (180ms) |
| Run progress (M5) | per-node ring pulse + flowing-dash wire; sequential, reads as a "front" |
| Save success | dirty pill fades out, Save shows a momentary check |

Respect `prefers-reduced-motion`: drop pulses/flows, keep instant state changes.

---

## 10. Accessibility & responsiveness

- **Keyboard:** Tab cycles nodes (selection follows); Enter opens inspector; Esc closes;
  Delete removes selected (with confirm); `⌘/Ctrl+S` saves; `⌘/Ctrl+Enter` runs;
  `+`/`-`/`0` zoom in/out/fit.
- **Focus & contrast:** visible focus rings on all controls (`--accent-flow`); kind is never
  encoded by color *alone* — the kind badge text (`TOOL`/`SKILL`) and icon carry it too.
  Status is reinforced with pips/icons, not just ring color.
- **Screen reader:** node cards are buttons labeled `"<nodeId>, <kind>, <n> inputs, status <…>"`;
  wires are decorative (`aria-hidden`), lineage exposed via the inspector.
- **Responsive:** desktop-first (this is a canvas tool). Below `~1024px`, the palette collapses
  to an icon rail and the inspector becomes a full-height sheet. Touch: drag-pan, pinch-zoom,
  tap-to-select supported; fine wiring is mouse-optimized.

---

## 11. Dark mode

First-class, not an afterthought — node-graph tools are often used in dark. The canvas goes to
a deep slate (`--canvas-bg` dark), dots dim, node surfaces use `--card` (dark), and the two
accents (azure / green) and the kind tints are tuned brighter (see §2) so they hold contrast on
dark. Shadows soften and a faint top highlight (`inset 0 1px 0 rgb(255 255 255 / 0.04)`) gives
cards a subtle "lit" edge.

---

## 12. Implementation notes (ties to the functional spec)

- Tokens in §2 are added to [`globals.css`](../apps/web/src/app/globals.css) under `:root` and
  `.dark`; everything else composes from Tailwind utilities + these vars — no hardcoded hex in
  components.
- Wires are a single SVG `<WireLayer>` (functional spec §5); ports report geometry up so the
  layer can draw beziers between real coordinates across zoom/pan.
- Each milestone gains its visual layer incrementally: M1 brings canvas + cards + wires + dark
  mode; M2 the drawer + source chips; M3 palette + insertion marker + invalid-wire styling;
  M4 the dirty pill + Save states; M5 the run rings + flowing-wire animation.
- This is a **design reference**, not a component inventory — the functional spec
  ([`VISUAL_CHAIN_EDITOR.md`](./VISUAL_CHAIN_EDITOR.md)) remains the source of truth for
  component boundaries, state, and milestones.
```
