# Proposal: Tool-Chain — composing agents from small, gated nodes

**Author:** Sakar
**Audience:** Engineering
**Status:** Proposal (pre-implementation)
**Companion docs:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) (the v1 engine spec)

---

## TL;DR

Our agent harness uses the LLM as the control-flow engine: every step of every turn
is chosen by the model at runtime. That is the right design for open-ended tasks and
the wrong design for the workflows we run thousands of times — document intelligence,
extraction, structured pipelines. For those, LLM-as-router means routing errors are
model errors: untestable, non-deterministic, hard to audit, and expensive.

**This proposal:** build a separate system where the *route is data, not a model
decision*. An agent is assembled from the smallest possible reusable units — **nodes**
(`tool` = deterministic I/O, `skill` = one bounded LLM call) — wired into a **chain**
that the engine executes deterministically, validating a typed contract at every
boundary and running **eval gates** between steps. The LLM is demoted from orchestrator
to one typed transform inside a single node.

It is **standalone** (its own repo, TS/Next/Supabase) so blast radius on the existing
harness is zero. We prove the model end-to-end before proposing any integration.

---

## 1. The problem, precisely

The current harness loop is fully LLM-coupled. Every iteration:

```
ask the model → read stop_reason → dispatch whatever tool it picked → append result → repeat
```

up to 100 iterations per turn. This has four consequences for our repeated, high-volume
workflows:

1. **Routing errors are model errors.** Whether the agent calls `extract` before
   `parse`, in the right order, with the right arguments, is decided by a weight matrix
   at runtime. You cannot unit-test "did it route correctly" — the decision isn't in code.

2. **Failures are diffuse, not localized.** A bad run is "the agent did something wrong"
   somewhere across dozens of tool calls. There is no typed contract at tool boundaries,
   so there's no single place that says *which* step failed and *why*.

3. **Our units are too big to test or reuse.** `extract_document` is one atomic call:
   detect → extract → bind → repair → persist. You can't test the pieces, recombine them,
   or swap one out. Skills are worse — they are *reference text the LLM re-derives into
   bash on every invocation*, so a skill's reliability is re-rolled each time it runs.

4. **Cost & latency scale with the LLM, not the work.** Every routing decision is a full
   streaming model call, even for steps that need no reasoning at all.

For document intelligence specifically — the same extraction, over and over, with
enterprise audit requirements — this is the wrong set of trade-offs.

---

## 2. The idea

A **Node** is the atomic, ID-addressable unit of work — one file, one job, one contract:

- **Tool node** — deterministic I/O (Drive, HTTP, DB). No LLM.
- **Skill node** — exactly one LLM call via `generateObject` + a Zod output schema.

A **Chain** is a DB-stored, ordered list of steps. Each step references a node by ID and
maps its inputs from the trigger, a prior step's output, or a literal. A generic
**engine** resolves the mapping, validates the Zod contract on the way *in* and *out* of
every node, runs the node, runs any attached **eval gates**, and persists a per-step
audit record.

```
trigger { fileId }
  s1  drive.download_file    fileId ← trigger        ⇒ BlobHandle      [gate: size > 0]
  s2  document.extract_text  file   ← s1.output       ⇒ { text }        [gate: text length ≥ N]
  s3  resume.parse_fields    text   ← s2.output.text  ⇒ ResumeDTO       [gate: name present]
result ← s3.output
```

The LLM fires only inside `s3`, and only to fill a schema-bounded object. It never picks
the next step. **The route is a DB row.**

Long-term the chain becomes a DAG (fan-out / branch / merge) and chains become invocable
*as nodes* inside other chains — but v1 is deliberately linear to prove the model cheaply.

---

## 3. Why this is better architecture

| Dimension | Current harness (LLM-as-router) | Tool-Chain (data-as-router) |
|---|---|---|
| **Control flow** | Model decides every step at runtime | Deterministic; the route is a DB row, replayable |
| **Failure mode** | Diffuse — "something went wrong" across N calls | Typed & localized: which node, which boundary, why |
| **Testability** | Can't test routing; big tools untestable in pieces | Every node tested in isolation against its Zod contract |
| **Reuse** | Coarse tools, non-reusable; skills re-derived each run | One node, one job — reused across chains unchanged |
| **Accuracy** | One hard-coded content gate; bad data poisons later LLM steps | Hard-block gates at every boundary stop garbage at its source |
| **Cost / latency** | A full LLM call per routing decision | LLM tokens spent only on nodes that need reasoning |
| **Auditability** | Transcript of model decisions | Per-step audit rows + which gate passed/failed on which run |
| **Best at** | Open-ended, novel tasks | Known, repeated, high-volume workflows |

The mechanism behind "less LLM, more accurate" is one insight: **bad intermediate data is
what poisons LLM steps.** An image-only PDF yields empty text; the parse skill then
hallucinates a resume from nothing. Hard-block-by-default gates at every boundary mean
garbage stops at the step that produced it — not three steps later inside a model call.
Removing LLM involvement and catching errors earlier are the *same move*.

### The honest counter-point

The current harness is **better at open-ended, novel work** *because* the LLM routes.
Tool-Chain trades that flexibility for reliability on **known, repeated** workflows. That
is the right trade for document intelligence and the wrong trade for a general research
agent. The two are not competitors. The eventual integration is *"the LLM invokes a
trusted chain as one step"* — chains for the paved road, the LLM for the wilderness.

---

## 4. Evals as a first-class, layered system

Evals are not test files on the side — they are ID-addressable units attached to nodes
and chains in the DB, so every run carries an audit trail of what passed.

| Layer | Type | When | Purpose | v1? |
|---|---|---|---|---|
| 1 | **Inline step gates** | Live, every run | Deterministic pass/fail at each boundary; bad data never propagates | ✅ |
| 2 | **Offline chain suite** | On-demand / CI | Golden fixtures → expected outputs; regression safety before trusting a chain | ✅ |
| 3 | **LLM-as-judge** | In the suite, skill outputs only | Score outputs that aren't simple assertions; kept *offline* so no LLM re-enters the live path | later |
| 4 | **A/B variant compare** | On-demand | Run two node/chain versions over one eval set, diff scores — *proves "less LLM, ≥ accuracy" as a number* | later |

**Default gate behavior: hard-block, per-gate soft override.** A failed gate stops the
chain and records a typed `GateFailed` result; individual gates can be marked soft. Safest
default for enterprise — bad intermediate data never silently reaches a later step.

---

## 5. Expected impact

An honest per-axis assessment, with confidence levels. Everything here is reasoned
prediction until sub-project 3 (A/B compare) makes it measured fact — which is why that
sub-project is worth prioritizing. Confidence is stated so we can disagree on the right
things.

| Axis | Verdict | Confidence | Why |
|---|---|---|---|
| **Latency** | Improves, often substantially | High | Eliminates the per-step LLM round-trip; only skill nodes cost a model call |
| **Accuracy (routing)** | Improves materially | High | The model never picks wrong-tool / wrong-order / skipped-step — it doesn't pick at all |
| **Accuracy (in-node)** | Roughly unchanged | High | A skill node is the same model + prompt; the chain feeds it clean input, not a better brain |
| **Error containment** | Improves | High | Gates fail loudly at the boundary instead of silently poisoning later steps |
| **Cost / tokens** | Improves at scale | High | No LLM spend on routing decisions; compounds over high-volume reruns |
| **Eng efficiency** | Worse upfront, better on reuse | Medium | Nodes + schemas + gates are more work to write; break-even is workflow *repetition* |
| **Flexibility** | Worse (by design) | High | Rigid where the harness was adaptive — the deliberate trade |

**Latency — confident win.** The current loop spends a full streaming model call on every
routing decision (up to 100 iterations/turn). A chain collapses that to *at most the number
of skill nodes* in LLM calls. Drive→resume has one skill node, so it goes from N model
round-trips to one; deterministic nodes run at I/O speed. Caveat: this holds only while the
route is fixed. Dynamic, content-based branching in a future DAG reintroduces decision
points — keep those deterministic or the win erodes.

**Accuracy — real, but narrower than a headline implies.** Chains don't make the LLM
smarter; they (a) remove it from routing decisions it was never good at, and (b) stop bad
data from reaching it. The big structural win is routing accuracy. The raw quality of any
single skill node's output is unchanged — same model, same failure modes. Gates *contain*
errors (convert "silently wrong" into "loudly failed"), which is better for enterprise
trust, but that is error containment, not error elimination.

**Efficiency — token cost down, engineering cost front-loaded.** Runtime tokens drop for
the same reason latency does. But writing a node + Zod schema + gate is genuinely more
upfront work than letting the model wing it. The payoff lands on the *second* use — a
reused node, a re-run chain, a regression caught by the suite. For a workflow run **once**,
the chain model is *less* efficient than just asking the LLM. The break-even is repetition,
which is exactly why doc-intel (same extraction, thousands of times) is the right first
target and a one-off task is the wrong one.

**The risk is scope, not architecture.** The pattern is sound; the failure mode is
*over-applying* it — forcing genuinely open-ended tasks into rigid chains because chains
feel safer, then spending more effort fighting the rigidity than LLM-routing ever cost.
The discipline of *"chains for the paved road, the LLM for the wilderness"* is what decides
whether this is a net win or a new kind of tech debt.

---

## 6. How the team will experience this change

Honest read on adoption, since that's what the question really asks:

**What lands easily**
- It's **additive and isolated** — separate repo, zero changes to the running harness. No
  one's current work is disrupted; nothing to migrate on day one.
- The contracts are **familiar**: Zod schemas, typed results, TDD, one-file-one-job. This
  is the discipline the team already values, applied to agent composition.
- **"Finally testable."** Anyone who's debugged a 40-tool-call agent run will feel the
  relief of "which node, which boundary, why" immediately.

**Where there will be friction / honest skepticism**
- *"We already have a harness — why a second system?"* → Answer: not a replacement, a
  different tool for repeated workflows. We prove it standalone before any integration ask.
- *"Linear chains are too rigid for real tasks."* → True for novel work; that's not the
  target. Target is the workflows we run thousands of times. DAG comes in v2.
- *"Writing nodes + schemas + gates is more upfront work than letting the model wing it."*
  → Yes — and that upfront cost is exactly what buys testability, reuse, and the audit
  trail. It amortizes the moment a node is reused or a chain is re-run.
- **The visual builder is a real product surface**, not a weekend UI. Scoping it as its own
  sub-project (below) is deliberate so it doesn't bloat the engine.

**Net:** I expect strong buy-in on the engine + evals (it solves pain people feel daily),
healthy debate on linear-vs-DAG and on the second-system question, and genuine excitement
about the builder once the engine is proven.

---

## 7. Delivery plan — three sub-projects, built bottom-up

```
Sub-project 1: ENGINE + EVALS  ← this is what we'd start
  node abstraction · chain executor · inline gates · offline suite
  acceptance: Drive→resume runs end-to-end, gates block bad data, suite scores the chain

Sub-project 2: VISUAL GRAPH BUILDER
  palette · node-graph canvas · input wiring · gate attachment · save→run→live status
  acceptance: a non-engineer composes & runs the Drive→resume chain and watches it pass

Sub-project 3: A/B VARIANT COMPARE
  run two variants over one eval set · diff scores
  acceptance: "less LLM, ≥ accuracy" shown as a measured number
```

Each sub-project ends in a runnable artifact — we're never more than one phase from
demonstrable value. Sub-project 1's acceptance gate is the existing `ARCHITECTURE.md` e2e
test: **Drive→resume produces correct `ResumeDTO` with recorded fixtures.**

---

## 8. Scope discipline (what v1 is NOT)

Deliberately deferred to protect the first deliverable: DAG/non-linear execution,
chain-of-chains composition, LLM-as-judge, A/B compare, the visual builder, node
versioning, multi-tenant/RLS, retry/idempotency metadata. The engine is "the minimum
clean code that passes the Drive→resume test" — not a deliverable in its own right.

**Seams we protect now so v2 is cheap:** the `Ref` model is already DAG-ready (a step can
point to *any* earlier step) though the executor is linear; the DB schema reserves room for
node `version` columns. v2's biggest unlocks (DAG, versioning) become *executor/feature*
changes, not data migrations.

---

## 9. The ask

1. **Feedback** on the architecture and the second-system framing — especially the
   linear-vs-DAG and "why not extend the harness" questions.
2. **Green-light sub-project 1** (engine + evals, Drive→resume acceptance) as a
   time-boxed, isolated proof. It touches nothing in production.
3. After sub-project 1 is green, a **review checkpoint** to decide whether to fund the
   builder and the eventual harness integration.

---

## Appendix: glossary

- **Node** — atomic, ID-addressable unit. One file, one job. `tool` (deterministic) or `skill` (one LLM call).
- **Chain** — DB-stored ordered steps wiring nodes into a pipeline.
- **Step** — one position in a chain: a `nodeId` + an `inputMapping`.
- **Ref** — how a step's input is sourced: trigger / prior-step / literal. (DAG-ready.)
- **Gate** — an eval attached to a step boundary; hard-block by default.
- **BlobHandle** — a reference to a file in Storage; what flows through the pipeline instead of raw bytes.
- **Run / StepRun** — persisted audit records of a chain execution and each step.
