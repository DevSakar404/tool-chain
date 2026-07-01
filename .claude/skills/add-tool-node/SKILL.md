---
name: add-tool-node
description: Add a new tool node to the tool-chain engine and register it in the NodeRegistry. Use whenever the user wants a new deterministic-I/O unit in this repo — phrases like "add a tool to the registry", "make a new tool node", "I need a node that fetches/uploads/calls X", "register a tool for Y", or "add a Gmail/Slack/HTTP tool to the chain". Trigger this even when the user only names the data source ("add a Gmail tool to fetch the resume") without saying the words "node" or "registry", because in this codebase a reusable source/sink is always a tool node that must be registered to be usable in a chain.
---

# Add a Tool Node

Add a new `kind: "tool"` node (deterministic I/O — Drive, Gmail, HTTP, Supabase; **no LLM**) to `packages/core` and register it so chains can reference it by id.

This is the recipe behind every existing tool node (`drive.download_file`, `document.extract_text`). Follow the same shape so the engine never changes when a node is added (Open/Closed — see `docs/ARCHITECTURE.md` D1/D2/D7).

## Mental model — the four moving parts

A tool node touches up to four files. The middle two are always needed; the outer two only when the node does external I/O.

```
contract (IRunContext.ts)   ──► capability interface   [only if new external I/O]
adapter  (infra/<svc>/...)  ──► concrete impl of that  [only if new external I/O]
node     (nodes/tools/...)  ──► the unit itself         [ALWAYS]
register (nodes/index.ts)   ──► makes it reachable      [ALWAYS]
buildEngine (di/...)        ──► wires the adapter in    [only if new capability]
```

**The decision that drives everything: does this node need a *new* capability handle?**

- **Pure transform** (reshapes its input, no network/disk) → node + register only. No adapter.
- **Uses an existing capability** (`ctx.drive`, `ctx.storage`, `ctx.llm`) → node + register only. The seam already exists.
- **New external service** (Gmail, Slack, a REST API) → add a capability interface to `IRunContext`, an adapter under `infra/`, wire it in `buildEngine`, then node + register.

Nodes **never** hold raw secrets or call `fetch` against an authed API directly — that lives in the adapter behind a capability handle (D7). A node that needs a token is a signal you're missing a capability.

## Recipe

Work TDD: write the node's test first (red), then make it green. Lead with the node test — it's the highest-value, smallest test.

### Step 1 — Decide the contract (input/output Zod schemas)

Pick the smallest input and output that do one job. Reuse existing DTOs where the boundary matches — e.g. anything that produces a file returns a `BlobHandle` (from `contracts/dtos.ts`) so it slots into `document.extract_text` unchanged. Defining a fresh output shape only to re-wrap a `BlobHandle` is a smell.

Name the node `<domain>.<verb>_<noun>`, lowercase dotted — `drive.download_file`, `gmail.fetch_attachment`. This id is the stable address chains use.

### Step 2 — (If new external I/O) add the capability interface

In `packages/core/src/contracts/IRunContext.ts`, add an interface describing *what the node can do*, not how:

```typescript
export interface IGmailCapability {
  /** Fetch the first resume-like attachment; returns a BlobHandle, never raw bytes. */
  fetchAttachment(messageId: string): Promise<BlobHandle>;
}
```

Add it to `IRunContext` as a `readonly` field (`readonly gmail: IGmailCapability;`). Keep the docstring about *capability*, not credentials — the token is the adapter's secret.

### Step 3 — (If new external I/O) write the adapter

Under `packages/core/src/infra/<service>/<Service>Capability.ts`, implement the interface.

- **Another Google API** (Sheets, Calendar, etc.) → **extend `infra/google/GoogleApiCapability.ts`**, don't duplicate it. That shared base already solves bearer-auth fetch with retry/backoff, size enforcement, and the buffer→`sha256`→`storage.upload`→`BlobHandle` tail; `GoogleDriveCapability` and `GmailCapability` are both thin subclasses that add only their own request/parse logic and set `protected abstract readonly apiErrorCode`. Read `GoogleDriveCapability.ts` as the reference subclass, not as something to copy wholesale.
- **A non-Google service** (Slack, a generic REST API) → there's no shared base yet, so hand-roll retry/backoff and the size guard following the same shape as `GoogleApiCapability` (or, if this is the second non-Google adapter, consider factoring a shared base at that point — not before, per YAGNI).

Either way:
- Constructor takes `{ accessToken, storage, ... }` — never a global secret import.
- Network failures → `throw new ChainError(msg, "<SERVICE>_API_ERROR")`. Expected "nothing found" conditions → their own code (e.g. `NO_RESUME_ATTACHMENT`). These codes are what surface to the user, so make them legible.
- Bytes go to `storage.upload(...)`; return a handle (`BlobHandle`), not a `Buffer`. No binary through the pipeline (D6).

### Step 4 — Write the node (always)

`packages/core/src/nodes/tools/<id>.ts`, extending `BaseNode` (it does validate-in / validate-out around your `run`, returning a typed `StepResult`). Match `drive.download_file.ts` exactly:

```typescript
import { z } from "zod";
import { BaseNode } from "../../node/BaseNode.js";
import { BlobHandleSchema } from "../../contracts/dtos.js";
import type { IRunContext } from "../../contracts/IRunContext.js";

const InputSchema = z.object({ messageId: z.string().min(1) });
type Input = z.infer<typeof InputSchema>;

export class GmailFetchAttachmentNode extends BaseNode<Input, z.infer<typeof BlobHandleSchema>> {
  readonly id = "gmail.fetch_attachment";
  readonly kind = "tool" as const;
  readonly inputSchema = InputSchema;
  readonly outputSchema = BlobHandleSchema;
  readonly description = "Fetch the first resume-like attachment from a Gmail message; returns a BlobHandle.";

  protected override async run(input: Input, ctx: IRunContext): Promise<z.infer<typeof BlobHandleSchema>> {
    ctx.logger.info("Fetching Gmail attachment", { messageId: input.messageId });
    return ctx.gmail.fetchAttachment(input.messageId);
  }
}

export const gmailFetchAttachmentNode = new GmailFetchAttachmentNode();
```

The node body stays thin: log + delegate to the capability. All I/O complexity lives in the adapter. The file exports a **singleton instance** (`export const ...Node = new ...()`) — that's what the registry registers.

`.js` import extensions are required (NodeNext ESM) even though the files are `.ts`. One node = one file = one job.

### Step 5 — Register it (always)

In `packages/core/src/nodes/index.ts`: import the singleton, add a `registry.register(...)` line in `registerAll`, and re-export it. This is the only place the engine learns the node exists — miss it and the node is invisible to chains (`NodeNotFoundError` at run time).

### Step 6 — (If new capability) wire the adapter in buildEngine

In `packages/core/src/di/buildEngine.ts`: add the token to `BuildEngineOptions` (e.g. `gmailAccessToken: string`), construct the adapter, and add it to the object returned by `ctxFactory` so every run's `IRunContext` carries it. Then surface the env var in `apps/web` where the engine is built. Tokens are short-lived OAuth access tokens — document the scope alongside the existing `GOOGLE_ACCESS_TOKEN`.

### Step 7 — Tests (write the node test first, in Step 4's red phase)

- **Node test** (`__tests__/nodes/<id>.test.ts`): mock `ctx` with a fake capability; assert valid input → `{ ok: true, output }` passthrough, and invalid input → `{ ok: false, kind: "InputInvalid" }`. Mirror an existing node test.
- **Adapter test** (`__tests__/infra/<Service>Capability.test.ts`, only if you added an adapter): mock `fetch`; assert the happy path produces a correct handle, and each typed `ChainError` code fires on its condition.

### Step 8 — Verify

```bash
pnpm --filter @tool-chain/core build   # apps/web resolves core via dist/
pnpm -r typecheck                       # strict, both packages
pnpm -r test                            # new tests green, existing unaffected
```

## Completeness checklist

- [ ] Node id is `<domain>.<verb>_<noun>`, lowercase dotted, unique.
- [ ] `kind = "tool" as const` and **no LLM call** (that would be a skill node, not a tool).
- [ ] Input/output are minimal Zod schemas; file-producing nodes output `BlobHandle`.
- [ ] Node body is thin: it logs and delegates; no `fetch`, no raw secrets in the node.
- [ ] New external I/O → capability interface on `IRunContext` **and** adapter under `infra/` **and** `buildEngine` wiring.
- [ ] Singleton exported from the node file and added to `registerAll` in `nodes/index.ts`.
- [ ] `.js` extensions on relative imports.
- [ ] Node test written first; adapter test if an adapter was added.
- [ ] `build` → `typecheck` → `test` all green.

## Common mistakes

| Mistake | Fix |
|---|---|
| Node calls `fetch`/holds a token directly | Move I/O behind a capability handle on `IRunContext`; the node delegates (D7). |
| Forgot `registry.register(...)` in `nodes/index.ts` | The node runs nowhere until registered — add it and re-export. |
| New output DTO that just re-wraps a file | Return `BlobHandle` so it composes with `document.extract_text`. |
| Threw a raw `Error` with the API response body | Throw a typed `ChainError` with a legible code; raw bodies can leak secrets (D8). |
| Missing `.js` on imports | NodeNext ESM needs them even for `.ts` sources — typecheck fails otherwise. |
| Put LLM reasoning in a tool node | That's a skill node (`kind: "skill"`, uses `ctx.llm`); tools are deterministic I/O only. |

## Quick reference

```
1. Schemas — minimal Zod in/out; reuse BlobHandle for files; id = domain.verb_noun
2. New service? → capability iface on IRunContext  + adapter in infra/ (model on GoogleDriveCapability)
3. Node file in nodes/tools/ extending BaseNode; thin run() that delegates; export singleton
4. Register in nodes/index.ts (register + re-export)
5. New capability? → wire adapter + token in buildEngine + apps/web env
6. Node test first (passthrough + InputInvalid); adapter test if adapter added
7. build → typecheck → test
```
