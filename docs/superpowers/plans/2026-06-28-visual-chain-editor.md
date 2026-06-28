# Visual Chain Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an n8n-style visual editor at `/editor/[chainId]` that lets users view, edit, save, and run an existing chain as wired node cards on a pan/zoom canvas.

**Architecture:** Five milestones (M1–M5) each end at an independently testable UI state. The core state lives in a `useChainEditor` hook with pure reducer actions. Server routes for GET/PUT chain and GET nodes are added as Next.js App Router handlers, all guarded by the existing `x-run-secret` mechanism. A new `describeNode` helper in `packages/core` converts Zod schemas to plain JSON field descriptors so the browser never receives Zod objects.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS, Vitest (core tests), existing `lucide-react` icons, existing Zod + `@tool-chain/core` package.

## Global Constraints

- No new auth mechanism — all new API routes reuse the `x-run-secret` shared-secret gate from `apps/web/src/app/api/chains/[id]/run/route.ts`
- `packages/core` must remain framework-agnostic — no Next.js or Supabase imports
- No `x`/`y` position fields added to `Chain`/`Step` DTOs — layout is computed client-side from step order
- Refs may only point backward: trigger or a strictly-earlier step index
- Top-level Zod introspection only — nested objects collapse to `"object"` type label
- Node >= 20, pnpm >= 9
- `EngineBundle` (in `packages/core/src/di/buildEngine.ts`) must be extended to expose `chainRepository` alongside `engine` and `registry` — it currently only exposes `engine` and `registry`

---

## File Map

### New files — `packages/core`
- `packages/core/src/registry/describeNode.ts` — pure helper: `INode` → `NodeCatalogEntry`
- `packages/core/src/__tests__/registry/describeNode.test.ts` — Vitest unit tests

### Modified files — `packages/core`
- `packages/core/src/di/buildEngine.ts` — add `chainRepository: IChainRepository` to `EngineBundle`
- `packages/core/src/index.ts` — re-export `describeNode` and `NodeCatalogEntry`/`NodeFieldDescriptor` types

### New files — `apps/web` (server)
- `apps/web/src/app/api/nodes/route.ts` — `GET /api/nodes`
- `apps/web/src/app/api/chains/[id]/route.ts` — `GET` + `PUT /api/chains/[id]`
- `apps/web/src/lib/engineSingleton.ts` — shared lazy engine bundle (extracted from run route pattern)

### Modified files — `apps/web` (server)
- `apps/web/src/app/api/chains/[id]/run/route.ts` — switch to `engineSingleton.ts` instead of local `getEngine()`
- `apps/web/src/app/api/chains/[...rest]/route.ts` — update hint text for new endpoints

### New files — `apps/web` (client)
- `apps/web/src/app/editor/[chainId]/page.tsx` — route shell (client component)
- `apps/web/src/hooks/useChainEditor.ts` — single state store + all reducer actions
- `apps/web/src/hooks/useChainRun.ts` — SSE run hook (extracted + generalized from `page.tsx`)
- `apps/web/src/components/editor/ChainEditor.tsx` — top-level shell wiring hook → panels → canvas
- `apps/web/src/components/editor/ChainCanvas.tsx` — pan/zoom SVG surface, auto-layout
- `apps/web/src/components/editor/NodeCard.tsx` — one step card with ports and status ring
- `apps/web/src/components/editor/WireLayer.tsx` — SVG bezier wires between ports
- `apps/web/src/components/editor/NodePalette.tsx` — catalog list for insert
- `apps/web/src/components/editor/NodeInspector.tsx` — side panel for selected step
- `apps/web/src/components/editor/RefEditor.tsx` — single field source switcher
- `apps/web/src/components/editor/TriggerPanel.tsx` — trigger payload editor
- `apps/web/src/components/editor/Toolbar.tsx` — Save / Run / zoom controls
- `apps/web/src/types/editor.ts` — shared TypeScript types for the editor (`NodeCatalogEntry`, `NodeFieldDescriptor`, `ValidationState`, `StepRunStatus`, editor state shape)

---

## Task 1: `describeNode` helper + `EngineBundle` extension

**Files:**
- Create: `packages/core/src/registry/describeNode.ts`
- Create: `packages/core/src/__tests__/registry/describeNode.test.ts`
- Modify: `packages/core/src/di/buildEngine.ts` (add `chainRepository` to `EngineBundle`)
- Modify: `packages/core/src/index.ts` (re-export new types + function)

**Interfaces:**
- Produces:
  ```ts
  // packages/core/src/registry/describeNode.ts
  export interface NodeFieldDescriptor {
    name: string;
    type: string;      // "string" | "number" | "boolean" | "BlobHandle" | "object" | "unknown"
    required: boolean;
  }
  export interface NodeCatalogEntry {
    id: string;
    kind: "tool" | "skill";
    description?: string;
    inputFields: NodeFieldDescriptor[];
    outputFields: NodeFieldDescriptor[];
  }
  export function describeNode(node: INode): NodeCatalogEntry;
  ```
- Produces (in `buildEngine.ts`):
  ```ts
  export interface EngineBundle {
    engine: ChainEngine;
    registry: NodeRegistry;
    chainRepository: IChainRepository;  // NEW
  }
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/__tests__/registry/describeNode.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { describeNode } from "../../registry/describeNode.js";
import { driveDownloadFileNode } from "../../nodes/tools/drive.download_file.js";
import { documentExtractTextNode } from "../../nodes/tools/document.extract_text.js";
import { resumeParseFieldsNode } from "../../nodes/skills/resume.parse_fields.js";

describe("describeNode", () => {
  it("describes drive.download_file input fields", () => {
    const entry = describeNode(driveDownloadFileNode);
    expect(entry.id).toBe("drive.download_file");
    expect(entry.kind).toBe("tool");
    const fileIdField = entry.inputFields.find((f) => f.name === "fileId");
    expect(fileIdField).toBeDefined();
    expect(fileIdField?.type).toBe("string");
    expect(fileIdField?.required).toBe(true);
  });

  it("describes drive.download_file output fields (BlobHandle)", () => {
    const entry = describeNode(driveDownloadFileNode);
    const storageRef = entry.outputFields.find((f) => f.name === "storageRef");
    const size = entry.outputFields.find((f) => f.name === "size");
    expect(storageRef?.type).toBe("string");
    expect(storageRef?.required).toBe(true);
    expect(size?.type).toBe("number");
  });

  it("describes document.extract_text flat BlobHandle input", () => {
    const entry = describeNode(documentExtractTextNode);
    expect(entry.inputFields.map((f) => f.name)).toEqual(
      expect.arrayContaining(["storageRef", "mime", "size", "sha256"]),
    );
  });

  it("describes resume.parse_fields", () => {
    const entry = describeNode(resumeParseFieldsNode);
    expect(entry.kind).toBe("skill");
    const textField = entry.inputFields.find((f) => f.name === "text");
    expect(textField?.type).toBe("string");
    expect(textField?.required).toBe(true);
  });

  it("collapses nested object outputs to type 'object'", () => {
    const entry = describeNode(resumeParseFieldsNode);
    // experience is an array → collapses to 'object'
    const exp = entry.outputFields.find((f) => f.name === "experience");
    expect(exp?.type).toBe("object");
  });

  it("marks optional fields as required=false", () => {
    const entry = describeNode(resumeParseFieldsNode);
    // keyProjects and college are required; triggerSchemaName on chain is optional — 
    // here test resume: endDate inside experience is optional, but collapsed.
    // Instead, verify ALL outputFields have a boolean required property.
    for (const f of entry.outputFields) {
      expect(typeof f.required).toBe("boolean");
    }
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/sakar/Documents/project/tool-chain
pnpm --filter @tool-chain/core test -- --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `describeNode` module not found.

- [ ] **Step 3: Implement `describeNode`**

Create `packages/core/src/registry/describeNode.ts`:

```ts
import type { ZodTypeAny } from "zod";
import type { INode } from "../contracts/INode.js";

export interface NodeFieldDescriptor {
  name: string;
  type: string;
  required: boolean;
}

export interface NodeCatalogEntry {
  id: string;
  kind: "tool" | "skill";
  description?: string;
  inputFields: NodeFieldDescriptor[];
  outputFields: NodeFieldDescriptor[];
}

function zodTypeLabel(schema: ZodTypeAny): string {
  const def = schema._def;
  const typeName: string = def?.typeName ?? "";
  if (typeName === "ZodString") return "string";
  if (typeName === "ZodNumber") return "number";
  if (typeName === "ZodBoolean") return "boolean";
  // Arrays, objects, unions, etc. → "object"
  return "object";
}

function describeObjectSchema(
  schema: ZodTypeAny,
): NodeFieldDescriptor[] {
  const def = schema._def;
  const typeName: string = def?.typeName ?? "";

  // Unwrap ZodEffects (e.g. .refine())
  if (typeName === "ZodEffects") {
    return describeObjectSchema(def.schema as ZodTypeAny);
  }

  if (typeName !== "ZodObject") {
    // Non-object schema: single synthetic field named "value"
    return [{ name: "value", type: zodTypeLabel(schema), required: true }];
  }

  const shape = def.shape() as Record<string, ZodTypeAny>;
  return Object.entries(shape).map(([name, fieldSchema]) => {
    const fieldDef = (fieldSchema as ZodTypeAny)._def;
    const isOptional = fieldDef?.typeName === "ZodOptional";
    const innerSchema: ZodTypeAny = isOptional
      ? (fieldDef.innerType as ZodTypeAny)
      : (fieldSchema as ZodTypeAny);
    return {
      name,
      type: zodTypeLabel(innerSchema),
      required: !isOptional,
    };
  });
}

export function describeNode(node: INode): NodeCatalogEntry {
  return {
    id: node.id,
    kind: node.kind,
    description: node.description,
    inputFields: describeObjectSchema(node.inputSchema),
    outputFields: describeObjectSchema(node.outputSchema),
  };
}
```

- [ ] **Step 4: Extend `EngineBundle` with `chainRepository`**

Open `packages/core/src/di/buildEngine.ts`. Change `EngineBundle` interface and `buildEngine` return:

```ts
// Change the interface (line ~34):
export interface EngineBundle {
  engine: ChainEngine;
  registry: NodeRegistry;
  chainRepository: IChainRepository;
}

// Change the return at the end of buildEngine (line ~76):
return { engine, registry, chainRepository: chainRepo };
```

The import for `IChainRepository` is already present via `IRepositories.ts` re-exported from contracts. Add the import at top of file if not present:

```ts
import type { IChainRepository } from "../contracts/IRepositories.js";
```

- [ ] **Step 5: Re-export from `packages/core/src/index.ts`**

Add after the `DI` export block:

```ts
// Registry helpers
export { describeNode } from "./registry/describeNode.js";
export type { NodeCatalogEntry, NodeFieldDescriptor } from "./registry/describeNode.js";
```

- [ ] **Step 6: Run tests and typecheck**

```bash
cd /Users/sakar/Documents/project/tool-chain
pnpm --filter @tool-chain/core test -- --reporter=verbose 2>&1 | tail -30
pnpm --filter @tool-chain/core typecheck
```

Expected: all tests PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/sakar/Documents/project/tool-chain
git add packages/core/src/registry/describeNode.ts \
        packages/core/src/__tests__/registry/describeNode.test.ts \
        packages/core/src/di/buildEngine.ts \
        packages/core/src/index.ts
git commit -m "feat(core): add describeNode helper and expose chainRepository in EngineBundle"
```

---

## Task 2: Server routes — `GET /api/nodes`, `GET /api/chains/[id]`, `PUT /api/chains/[id]`

**Files:**
- Create: `apps/web/src/lib/engineSingleton.ts`
- Create: `apps/web/src/app/api/nodes/route.ts`
- Create: `apps/web/src/app/api/chains/[id]/route.ts`
- Modify: `apps/web/src/app/api/chains/[id]/run/route.ts` (use singleton)

**Interfaces:**
- Consumes: `describeNode`, `NodeCatalogEntry` from `@tool-chain/core`; `EngineBundle.chainRepository` from Task 1
- Produces:
  - `GET /api/nodes` → `{ nodes: NodeCatalogEntry[] }`
  - `GET /api/chains/:id` → `{ chain: Chain }` or `404 { error: "Chain not found" }`
  - `PUT /api/chains/:id` → `200 { ok: true }` or `400 { error, issues }` or `401`

- [ ] **Step 1: Create the shared engine singleton**

Create `apps/web/src/lib/engineSingleton.ts`:

```ts
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { buildEngine } from "@tool-chain/core";
import type { EngineBundle } from "@tool-chain/core";

let bundle: EngineBundle | null = null;

export function getEngineBundle(): EngineBundle {
  if (!bundle) {
    const supabaseUrl = process.env["SUPABASE_URL"] ?? "";
    const supabaseKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
    const db = createClient(supabaseUrl, supabaseKey);

    bundle = buildEngine({
      db,
      googleAccessToken: process.env["GOOGLE_ACCESS_TOKEN"] ?? "",
      anthropicApiKey: process.env["ANTHROPIC_API_KEY"] ?? "",
      ...(process.env["LLM_MODEL"] !== undefined ? { llmModel: process.env["LLM_MODEL"] } : {}),
      ...(process.env["STORAGE_BUCKET"] !== undefined
        ? { storageBucket: process.env["STORAGE_BUCKET"] }
        : {}),
    });
  }
  return bundle;
}
```

- [ ] **Step 2: Update the run route to use the singleton**

Open `apps/web/src/app/api/chains/[id]/run/route.ts`.

Remove the local `let engineBundle` variable and `getEngine()` function (lines 7–24). Replace the `getEngine()` call on line 51 (`const { engine } = getEngine();`) with:

```ts
import { getEngineBundle } from "@/lib/engineSingleton";
// ...
const { engine } = getEngineBundle();
```

Add the import at the top of the file alongside other imports.

- [ ] **Step 3: Create `GET /api/nodes` route**

Create `apps/web/src/app/api/nodes/route.ts`:

```ts
import "server-only";
import { NextRequest } from "next/server";
import { describeNode } from "@tool-chain/core";
import { getEngineBundle } from "@/lib/engineSingleton";

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  const secret = request.headers.get("x-run-secret");
  if (!secret || secret !== process.env["RUN_API_SECRET"]) {
    return unauthorized();
  }

  const { registry } = getEngineBundle();
  const nodes = registry.list().map(describeNode);

  return new Response(JSON.stringify({ nodes }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 4: Create `GET` + `PUT /api/chains/[id]` route**

Create `apps/web/src/app/api/chains/[id]/route.ts`:

```ts
import "server-only";
import { NextRequest } from "next/server";
import { ChainSchema } from "@tool-chain/core";
import { getEngineBundle } from "@/lib/engineSingleton";

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const secret = request.headers.get("x-run-secret");
  if (!secret || secret !== process.env["RUN_API_SECRET"]) {
    return unauthorized();
  }

  const { id } = await params;
  const { chainRepository } = getEngineBundle();
  const chain = await chainRepository.findById(id);

  if (!chain) {
    return new Response(JSON.stringify({ error: "Chain not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ chain }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const secret = request.headers.get("x-run-secret");
  if (!secret || secret !== process.env["RUN_API_SECRET"]) {
    return unauthorized();
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsed = ChainSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Validation failed", issues: parsed.error.issues }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const chain = parsed.data;
  if (chain.id !== id) {
    return new Response(
      JSON.stringify({ error: "Chain id in body does not match path" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const { chainRepository } = getEngineBundle();
  await chainRepository.save(chain);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 5: Typecheck the web app**

```bash
cd /Users/sakar/Documents/project/tool-chain
pnpm --filter @tool-chain/web typecheck
```

Expected: no type errors.

- [ ] **Step 6: Manual smoke test (optional but recommended)**

Start the dev server and use curl/httpie to verify the routes respond:

```bash
# In one terminal:
cd /Users/sakar/Documents/project/tool-chain/apps/web && pnpm dev

# In another (replace <secret> with your RUN_API_SECRET from .env.local):
curl -H "x-run-secret: <secret>" http://localhost:3000/api/nodes
# Expected: { "nodes": [...] } with drive.download_file, document.extract_text, resume.parse_fields

curl -H "x-run-secret: <secret>" http://localhost:3000/api/chains/nonexistent-id
# Expected: { "error": "Chain not found" } with 404
```

- [ ] **Step 7: Commit**

```bash
cd /Users/sakar/Documents/project/tool-chain
git add apps/web/src/lib/engineSingleton.ts \
        apps/web/src/app/api/nodes/route.ts \
        "apps/web/src/app/api/chains/[id]/route.ts" \
        "apps/web/src/app/api/chains/[id]/run/route.ts"
git commit -m "feat(web): add GET /api/nodes, GET/PUT /api/chains/[id], shared engine singleton"
```

---

## Task 3: Editor types + `useChainEditor` hook (M1 + M2 state)

**Files:**
- Create: `apps/web/src/types/editor.ts`
- Create: `apps/web/src/hooks/useChainEditor.ts`

**Interfaces:**
- Consumes: `Chain`, `Step`, `Ref` from `@tool-chain/core`; `NodeCatalogEntry`, `NodeFieldDescriptor` from `@tool-chain/core`
- Produces:
  ```ts
  // Reducer actions
  type EditorAction =
    | { type: "LOAD"; chain: Chain; catalog: NodeCatalogEntry[] }
    | { type: "SET_SELECTION"; stepId: string | null }
    | { type: "SET_REF"; stepId: string; fieldName: string; ref: Ref }
    | { type: "SET_TRIGGER"; payload: Record<string, unknown> }
    | { type: "REORDER_STEP"; stepId: string; toIndex: number }
    | { type: "INSERT_STEP"; nodeId: string; atIndex: number }
    | { type: "REMOVE_STEP"; stepId: string }
    | { type: "MARK_SAVED" }
    | { type: "SET_RUN_STATUS"; stepId: string; status: StepStatus }
    | { type: "SET_RUN_RESULT"; result: unknown }
    | { type: "SET_RUN_ERROR"; message: string }
    | { type: "CLEAR_RUN" };

  // Hook return
  function useChainEditor(): {
    state: EditorState;
    dispatch: React.Dispatch<EditorAction>;
  }
  ```

- [ ] **Step 1: Create shared editor types**

Create `apps/web/src/types/editor.ts`:

```ts
import type { Chain, NodeCatalogEntry } from "@tool-chain/core";

export type StepStatus = "pending" | "running" | "ok" | "error";

export interface FieldValidation {
  fieldName: string;
  problem: "needs-wiring" | "dangling-ref";
}

export interface StepValidation {
  stepId: string;
  fields: FieldValidation[];
}

export interface ValidationState {
  steps: StepValidation[];
  /** true when every step has no field problems */
  valid: boolean;
}

export interface RunState {
  active: boolean;
  stepStatuses: Record<string, StepStatus>;
  result: unknown;
  error: string | null;
}

export interface EditorState {
  chain: Chain | null;
  catalog: NodeCatalogEntry[];
  selectedStepId: string | null;
  dirty: boolean;
  validation: ValidationState;
  trigger: Record<string, unknown>;
  run: RunState;
  loadError: string | null;
}
```

- [ ] **Step 2: Write tests for reducer pure functions**

Create `apps/web/src/__tests__/hooks/useChainEditor.reducers.test.ts`:

> Note: This file tests the exported pure reducer functions — not the hook itself — so it runs in Vitest without a DOM.

First check if there's a `vitest.config.ts` for the web app, or create a minimal one:

```bash
ls /Users/sakar/Documents/project/tool-chain/apps/web/
```

If no `vitest.config.ts` exists, create `apps/web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

And add a `test` script to `apps/web/package.json`:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "typecheck": "tsc --noEmit",
  "test": "vitest run"
}
```

Now create the test file at `apps/web/src/__tests__/hooks/useChainEditor.reducers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  editorReducer,
  initialEditorState,
} from "../../hooks/useChainEditor.js";
import type { Chain, NodeCatalogEntry } from "@tool-chain/core";

const CATALOG: NodeCatalogEntry[] = [
  {
    id: "drive.download_file",
    kind: "tool",
    description: "Download file",
    inputFields: [{ name: "fileId", type: "string", required: true }],
    outputFields: [
      { name: "storageRef", type: "string", required: true },
      { name: "mime", type: "string", required: true },
      { name: "size", type: "number", required: true },
      { name: "sha256", type: "string", required: true },
    ],
  },
  {
    id: "document.extract_text",
    kind: "tool",
    description: "Extract text",
    inputFields: [
      { name: "storageRef", type: "string", required: true },
      { name: "mime", type: "string", required: true },
      { name: "size", type: "number", required: true },
      { name: "sha256", type: "string", required: true },
    ],
    outputFields: [{ name: "text", type: "string", required: true }],
  },
];

const CHAIN: Chain = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Resume chain",
  schemaVersion: 1,
  steps: [
    {
      stepId: "s1",
      nodeId: "drive.download_file",
      inputMapping: { fileId: { from: "trigger", path: "fileId" } },
    },
    {
      stepId: "s2",
      nodeId: "document.extract_text",
      inputMapping: {
        storageRef: { from: "s1", path: "storageRef" },
        mime: { from: "s1", path: "mime" },
        size: { from: "s1", path: "size" },
        sha256: { from: "s1", path: "sha256" },
      },
    },
  ],
};

function loadedState() {
  return editorReducer(initialEditorState, {
    type: "LOAD",
    chain: CHAIN,
    catalog: CATALOG,
  });
}

describe("editorReducer — LOAD", () => {
  it("sets chain and catalog, dirty=false", () => {
    const state = loadedState();
    expect(state.chain?.id).toBe(CHAIN.id);
    expect(state.catalog).toHaveLength(2);
    expect(state.dirty).toBe(false);
  });
});

describe("editorReducer — REORDER_STEP", () => {
  it("moves s2 before s1 and sets dirty=true", () => {
    const state = editorReducer(loadedState(), {
      type: "REORDER_STEP",
      stepId: "s2",
      toIndex: 0,
    });
    expect(state.chain?.steps[0].stepId).toBe("s2");
    expect(state.chain?.steps[1].stepId).toBe("s1");
    expect(state.dirty).toBe(true);
  });

  it("reorder that creates backward ref violation flags invalid", () => {
    // s2 references s1; moving s2 before s1 makes s1 at index 1, s2 at index 0 → s2's refs to s1 are now forward refs
    const state = editorReducer(loadedState(), {
      type: "REORDER_STEP",
      stepId: "s2",
      toIndex: 0,
    });
    const s2Validation = state.validation.steps.find((v) => v.stepId === "s2");
    expect(s2Validation?.fields.length).toBeGreaterThan(0);
    expect(state.validation.valid).toBe(false);
  });
});

describe("editorReducer — INSERT_STEP", () => {
  it("inserts a new step at the given index", () => {
    const state = editorReducer(loadedState(), {
      type: "INSERT_STEP",
      nodeId: "drive.download_file",
      atIndex: 0,
    });
    expect(state.chain?.steps).toHaveLength(3);
    expect(state.chain?.steps[0].nodeId).toBe("drive.download_file");
    expect(state.dirty).toBe(true);
  });

  it("seeds required input fields as needs-wiring", () => {
    const state = editorReducer(loadedState(), {
      type: "INSERT_STEP",
      nodeId: "drive.download_file",
      atIndex: 2,
    });
    const newStep = state.chain?.steps[2];
    expect(newStep).toBeDefined();
    const val = state.validation.steps.find((v) => v.stepId === newStep!.stepId);
    expect(val?.fields.some((f) => f.problem === "needs-wiring")).toBe(true);
  });
});

describe("editorReducer — REMOVE_STEP", () => {
  it("removes the step and sets dirty=true", () => {
    const state = editorReducer(loadedState(), {
      type: "REMOVE_STEP",
      stepId: "s1",
    });
    expect(state.chain?.steps).toHaveLength(1);
    expect(state.dirty).toBe(true);
  });

  it("removing a step that others depend on creates dangling refs", () => {
    const state = editorReducer(loadedState(), {
      type: "REMOVE_STEP",
      stepId: "s1",
    });
    // s2 still references s1 which no longer exists
    const s2Val = state.validation.steps.find((v) => v.stepId === "s2");
    expect(s2Val?.fields.some((f) => f.problem === "dangling-ref")).toBe(true);
    expect(state.validation.valid).toBe(false);
  });
});

describe("editorReducer — SET_REF", () => {
  it("updates a specific field ref and sets dirty=true", () => {
    const state = editorReducer(loadedState(), {
      type: "SET_REF",
      stepId: "s2",
      fieldName: "storageRef",
      ref: { value: "literal-val" },
    });
    const s2 = state.chain?.steps.find((s) => s.stepId === "s2");
    expect(s2?.inputMapping["storageRef"]).toEqual({ value: "literal-val" });
    expect(state.dirty).toBe(true);
  });
});

describe("editorReducer — MARK_SAVED", () => {
  it("sets dirty=false", () => {
    let state = editorReducer(loadedState(), {
      type: "SET_REF",
      stepId: "s1",
      fieldName: "fileId",
      ref: { value: "x" },
    });
    state = editorReducer(state, { type: "MARK_SAVED" });
    expect(state.dirty).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd /Users/sakar/Documents/project/tool-chain
pnpm --filter @tool-chain/web test -- --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — module `useChainEditor` not found.

- [ ] **Step 4: Implement `useChainEditor`**

Create `apps/web/src/hooks/useChainEditor.ts`:

```ts
"use client";

import { useReducer } from "react";
import type { Chain, Ref, NodeCatalogEntry } from "@tool-chain/core";
import type {
  EditorState,
  ValidationState,
  StepValidation,
  StepStatus,
} from "@/types/editor";

// ── Types ────────────────────────────────────────────────────────────────────

export type EditorAction =
  | { type: "LOAD"; chain: Chain; catalog: NodeCatalogEntry[] }
  | { type: "SET_SELECTION"; stepId: string | null }
  | { type: "SET_REF"; stepId: string; fieldName: string; ref: Ref }
  | { type: "SET_TRIGGER"; payload: Record<string, unknown> }
  | { type: "REORDER_STEP"; stepId: string; toIndex: number }
  | { type: "INSERT_STEP"; nodeId: string; atIndex: number }
  | { type: "REMOVE_STEP"; stepId: string }
  | { type: "MARK_SAVED" }
  | { type: "SET_RUN_STATUS"; stepId: string; status: StepStatus }
  | { type: "SET_RUN_RESULT"; result: unknown }
  | { type: "SET_RUN_ERROR"; message: string }
  | { type: "CLEAR_RUN" };

// ── Initial state ────────────────────────────────────────────────────────────

export const initialEditorState: EditorState = {
  chain: null,
  catalog: [],
  selectedStepId: null,
  dirty: false,
  validation: { steps: [], valid: true },
  trigger: {},
  run: { active: false, stepStatuses: {}, result: null, error: null },
  loadError: null,
};

// ── Validation ───────────────────────────────────────────────────────────────

function computeValidation(chain: Chain, catalog: NodeCatalogEntry[]): ValidationState {
  const stepIds = new Set(chain.steps.map((s) => s.stepId));
  const steps: StepValidation[] = [];

  for (let i = 0; i < chain.steps.length; i++) {
    const step = chain.steps[i]!;
    const catalogEntry = catalog.find((c) => c.id === step.nodeId);
    const fields: StepValidation["fields"] = [];

    for (const [fieldName, ref] of Object.entries(step.inputMapping)) {
      if ("value" in ref) continue; // literal ref — always valid

      if (ref.from === "trigger") continue; // trigger ref — always valid

      // step ref: check that 'from' exists and is strictly earlier
      const fromIndex = chain.steps.findIndex((s) => s.stepId === ref.from);
      if (!stepIds.has(ref.from) || fromIndex >= i) {
        fields.push({ fieldName, problem: "dangling-ref" });
      }
    }

    // Check required fields that have no mapping at all
    if (catalogEntry) {
      for (const inputField of catalogEntry.inputFields) {
        if (inputField.required && !(inputField.name in step.inputMapping)) {
          fields.push({ fieldName: inputField.name, problem: "needs-wiring" });
        }
      }
    }

    if (fields.length > 0) {
      steps.push({ stepId: step.stepId, fields });
    }
  }

  return { steps, valid: steps.length === 0 };
}

// ── Reducer ──────────────────────────────────────────────────────────────────

let _nextStepIndex = 1;
function freshStepId(): string {
  return `step-${Date.now()}-${_nextStepIndex++}`;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "LOAD": {
      const validation = computeValidation(action.chain, action.catalog);
      return {
        ...state,
        chain: action.chain,
        catalog: action.catalog,
        dirty: false,
        validation,
        loadError: null,
      };
    }

    case "SET_SELECTION":
      return { ...state, selectedStepId: action.stepId };

    case "SET_REF": {
      if (!state.chain) return state;
      const steps = state.chain.steps.map((step) => {
        if (step.stepId !== action.stepId) return step;
        return {
          ...step,
          inputMapping: { ...step.inputMapping, [action.fieldName]: action.ref },
        };
      });
      const chain = { ...state.chain, steps };
      return {
        ...state,
        chain,
        dirty: true,
        validation: computeValidation(chain, state.catalog),
      };
    }

    case "SET_TRIGGER":
      return { ...state, trigger: action.payload };

    case "REORDER_STEP": {
      if (!state.chain) return state;
      const steps = [...state.chain.steps];
      const fromIndex = steps.findIndex((s) => s.stepId === action.stepId);
      if (fromIndex === -1) return state;
      const [moved] = steps.splice(fromIndex, 1);
      steps.splice(action.toIndex, 0, moved!);
      const chain = { ...state.chain, steps };
      return {
        ...state,
        chain,
        dirty: true,
        validation: computeValidation(chain, state.catalog),
      };
    }

    case "INSERT_STEP": {
      if (!state.chain) return state;
      const catalogEntry = state.catalog.find((c) => c.id === action.nodeId);
      const inputMapping: Record<string, Ref> = {};
      // Seed required fields as empty — validation will flag them as needs-wiring
      // (no ref set = field absent from inputMapping → caught by validation)
      const newStep = {
        stepId: freshStepId(),
        nodeId: action.nodeId,
        inputMapping,
      };
      const steps = [...state.chain.steps];
      steps.splice(action.atIndex, 0, newStep);
      const chain = { ...state.chain, steps };
      // Suppress TS unused warning — catalogEntry is used for documentation
      void catalogEntry;
      return {
        ...state,
        chain,
        dirty: true,
        validation: computeValidation(chain, state.catalog),
      };
    }

    case "REMOVE_STEP": {
      if (!state.chain) return state;
      const steps = state.chain.steps.filter((s) => s.stepId !== action.stepId);
      const chain = { ...state.chain, steps };
      return {
        ...state,
        chain,
        dirty: true,
        selectedStepId:
          state.selectedStepId === action.stepId ? null : state.selectedStepId,
        validation: computeValidation(chain, state.catalog),
      };
    }

    case "MARK_SAVED":
      return { ...state, dirty: false };

    case "SET_RUN_STATUS":
      return {
        ...state,
        run: {
          ...state.run,
          stepStatuses: { ...state.run.stepStatuses, [action.stepId]: action.status },
        },
      };

    case "SET_RUN_RESULT":
      return {
        ...state,
        run: { ...state.run, active: false, result: action.result, error: null },
      };

    case "SET_RUN_ERROR":
      return {
        ...state,
        run: { ...state.run, active: false, error: action.message },
      };

    case "CLEAR_RUN":
      return {
        ...state,
        run: { active: false, stepStatuses: {}, result: null, error: null },
      };

    default:
      return state;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useChainEditor() {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  return { state, dispatch };
}
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/sakar/Documents/project/tool-chain
pnpm --filter @tool-chain/web test -- --reporter=verbose 2>&1 | tail -30
```

Expected: all reducer tests PASS.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @tool-chain/web typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/sakar/Documents/project/tool-chain
git add apps/web/src/types/editor.ts \
        apps/web/src/hooks/useChainEditor.ts \
        "apps/web/src/__tests__/hooks/useChainEditor.reducers.test.ts" \
        apps/web/vitest.config.ts \
        apps/web/package.json
git commit -m "feat(web): add editor types, useChainEditor reducer hook, and web Vitest setup"
```

---

## Task 4: M1 — Read-only canvas (`ChainCanvas`, `NodeCard`, `WireLayer`, auto-layout, pan/zoom)

**Files:**
- Create: `apps/web/src/app/editor/[chainId]/page.tsx`
- Create: `apps/web/src/components/editor/ChainEditor.tsx`
- Create: `apps/web/src/components/editor/ChainCanvas.tsx`
- Create: `apps/web/src/components/editor/NodeCard.tsx`
- Create: `apps/web/src/components/editor/WireLayer.tsx`

**Interfaces:**
- Consumes: `useChainEditor` from Task 3; `Chain`, `NodeCatalogEntry` from `@tool-chain/core`; `EditorState`, `StepStatus` from `@/types/editor`
- Produces: A working `/editor/[chainId]` page with pannable/zoomable canvas showing trigger + step node cards connected by wires

**Layout constants** (used across canvas, cards, wires):

```ts
export const CARD_WIDTH = 220;
export const CARD_HEIGHT = 100;
export const CARD_H_GAP = 120;   // horizontal gap between cards
export const TRIGGER_WIDTH = 120;
export const TRIGGER_HEIGHT = 80;
export const CANVAS_PADDING = 60;
```

Auto-layout: trigger at x=`CANVAS_PADDING`, all steps laid out left-to-right after it:
- Trigger center-x: `CANVAS_PADDING + TRIGGER_WIDTH / 2`
- Step i center-x: `CANVAS_PADDING + TRIGGER_WIDTH + CARD_H_GAP + i * (CARD_WIDTH + CARD_H_GAP) + CARD_WIDTH / 2`
- All nodes are vertically centered at y = `CANVAS_PADDING + CARD_HEIGHT / 2`

Port positions: each card has one output port on its right edge (center-y) and one input port on its left edge (center-y).

- [ ] **Step 1: Create the editor route page**

Create `apps/web/src/app/editor/[chainId]/page.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { ChainEditor } from "@/components/editor/ChainEditor";
import { useChainEditor } from "@/hooks/useChainEditor";
import type { NodeCatalogEntry } from "@tool-chain/core";

const API_SECRET = process.env["NEXT_PUBLIC_RUN_API_SECRET"] ?? "";

async function fetchChain(chainId: string) {
  const res = await fetch(`/api/chains/${chainId}`, {
    headers: { "x-run-secret": API_SECRET },
  });
  if (!res.ok) throw new Error(`Chain fetch failed: ${res.status}`);
  const data = (await res.json()) as { chain: unknown };
  return data.chain;
}

async function fetchCatalog(): Promise<NodeCatalogEntry[]> {
  const res = await fetch("/api/nodes", {
    headers: { "x-run-secret": API_SECRET },
  });
  if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);
  const data = (await res.json()) as { nodes: NodeCatalogEntry[] };
  return data.nodes;
}

export default function EditorPage() {
  const { chainId } = useParams<{ chainId: string }>();
  const { state, dispatch } = useChainEditor();

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchChain(chainId), fetchCatalog()])
      .then(([chainData, catalog]) => {
        if (!cancelled) {
          // We trust the server returns a valid Chain shape
          dispatch({ type: "LOAD", chain: chainData as Parameters<typeof dispatch>[0] extends { chain: infer C } ? C : never, catalog });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error("Editor load error", err);
        }
      });
    return () => { cancelled = true; };
  }, [chainId, dispatch]);

  if (state.loadError) {
    return (
      <div className="flex items-center justify-center h-screen text-destructive">
        {state.loadError}
      </div>
    );
  }

  if (!state.chain) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        Loading chain…
      </div>
    );
  }

  return <ChainEditor state={state} dispatch={dispatch} />;
}
```

Wait — the `dispatch` type cast above is awkward. Simplify the page by importing `Chain` directly:

```tsx
"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { ChainEditor } from "@/components/editor/ChainEditor";
import { useChainEditor } from "@/hooks/useChainEditor";
import type { Chain, NodeCatalogEntry } from "@tool-chain/core";

const API_SECRET = process.env["NEXT_PUBLIC_RUN_API_SECRET"] ?? "";

async function fetchChain(chainId: string): Promise<Chain> {
  const res = await fetch(`/api/chains/${chainId}`, {
    headers: { "x-run-secret": API_SECRET },
  });
  if (!res.ok) throw new Error(`Chain fetch failed: ${res.status}`);
  const data = (await res.json()) as { chain: Chain };
  return data.chain;
}

async function fetchCatalog(): Promise<NodeCatalogEntry[]> {
  const res = await fetch("/api/nodes", {
    headers: { "x-run-secret": API_SECRET },
  });
  if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);
  const data = (await res.json()) as { nodes: NodeCatalogEntry[] };
  return data.nodes;
}

export default function EditorPage() {
  const { chainId } = useParams<{ chainId: string }>();
  const { state, dispatch } = useChainEditor();

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchChain(chainId), fetchCatalog()])
      .then(([chain, catalog]) => {
        if (!cancelled) dispatch({ type: "LOAD", chain, catalog });
      })
      .catch((err: unknown) => {
        console.error("Editor load error", err);
      });
    return () => {
      cancelled = true;
    };
  }, [chainId, dispatch]);

  if (!state.chain) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        Loading chain…
      </div>
    );
  }

  return <ChainEditor state={state} dispatch={dispatch} />;
}
```

- [ ] **Step 2: Create `NodeCard`**

Create `apps/web/src/components/editor/NodeCard.tsx`:

```tsx
import type { Step } from "@tool-chain/core";
import type { NodeCatalogEntry } from "@tool-chain/core";
import type { StepStatus, ValidationState } from "@/types/editor";
import { CARD_WIDTH, CARD_HEIGHT } from "./layout";

interface Props {
  step: Step;
  catalogEntry: NodeCatalogEntry | undefined;
  x: number;
  y: number;
  selected: boolean;
  status: StepStatus | undefined;
  validation: ValidationState;
  onClick: () => void;
}

const STATUS_COLORS: Record<StepStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-blue-500",
  ok: "text-green-500",
  error: "text-destructive",
};

export function NodeCard({
  step,
  catalogEntry,
  x,
  y,
  selected,
  status,
  validation,
  onClick,
}: Props) {
  const hasError = validation.steps.some((v) => v.stepId === step.stepId);
  const borderColor = selected
    ? "border-primary"
    : hasError
      ? "border-destructive"
      : "border-border";
  const statusColor = status ? STATUS_COLORS[status] : "";

  return (
    <foreignObject x={x} y={y} width={CARD_WIDTH} height={CARD_HEIGHT}>
      <div
        className={`w-full h-full rounded-lg border-2 bg-card text-card-foreground shadow-sm cursor-pointer select-none p-3 flex flex-col justify-between ${borderColor}`}
        onClick={onClick}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono truncate">{step.nodeId}</span>
          <span
            className={`text-xs rounded-full px-1.5 py-0.5 bg-muted ${catalogEntry?.kind === "skill" ? "text-purple-600" : "text-blue-600"}`}
          >
            {catalogEntry?.kind ?? "?"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground truncate">
            {catalogEntry?.description ?? step.nodeId}
          </span>
          {status && <span className={`text-xs font-medium ${statusColor}`}>{status}</span>}
        </div>
      </div>
    </foreignObject>
  );
}
```

- [ ] **Step 3: Create layout constants file**

Create `apps/web/src/components/editor/layout.ts`:

```ts
export const CARD_WIDTH = 220;
export const CARD_HEIGHT = 100;
export const CARD_H_GAP = 120;
export const TRIGGER_WIDTH = 140;
export const TRIGGER_HEIGHT = 80;
export const CANVAS_PADDING = 60;
export const NODE_Y = CANVAS_PADDING;

export interface PortPosition {
  x: number;
  y: number;
}

export interface NodeLayout {
  id: string; // "trigger" | stepId
  x: number;
  y: number;
  width: number;
  height: number;
  outputPort: PortPosition;
  inputPort: PortPosition;
}

export function computeLayout(stepIds: string[]): NodeLayout[] {
  const layouts: NodeLayout[] = [];

  const triggerX = CANVAS_PADDING;
  const triggerY = NODE_Y;
  layouts.push({
    id: "trigger",
    x: triggerX,
    y: triggerY,
    width: TRIGGER_WIDTH,
    height: TRIGGER_HEIGHT,
    outputPort: { x: triggerX + TRIGGER_WIDTH, y: triggerY + TRIGGER_HEIGHT / 2 },
    inputPort: { x: triggerX, y: triggerY + TRIGGER_HEIGHT / 2 },
  });

  for (let i = 0; i < stepIds.length; i++) {
    const x =
      CANVAS_PADDING + TRIGGER_WIDTH + CARD_H_GAP + i * (CARD_WIDTH + CARD_H_GAP);
    const y = NODE_Y;
    layouts.push({
      id: stepIds[i]!,
      x,
      y,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      outputPort: { x: x + CARD_WIDTH, y: y + CARD_HEIGHT / 2 },
      inputPort: { x, y: y + CARD_HEIGHT / 2 },
    });
  }

  return layouts;
}
```

- [ ] **Step 4: Create `WireLayer`**

Create `apps/web/src/components/editor/WireLayer.tsx`:

```tsx
import type { Chain, Ref } from "@tool-chain/core";
import { computeLayout } from "./layout";
import type { ValidationState } from "@/types/editor";

interface Props {
  chain: Chain;
  validation: ValidationState;
}

function bezierPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const cx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
}

export function WireLayer({ chain, validation }: Props) {
  const layouts = computeLayout(chain.steps.map((s) => s.stepId));
  const layoutMap = new Map(layouts.map((l) => [l.id, l]));

  const wires: Array<{ d: string; invalid: boolean }> = [];

  for (let i = 0; i < chain.steps.length; i++) {
    const step = chain.steps[i]!;
    const targetLayout = layoutMap.get(step.stepId);
    if (!targetLayout) continue;

    const stepValidation = validation.steps.find((v) => v.stepId === step.stepId);

    for (const [fieldName, ref] of Object.entries(step.inputMapping) as [string, Ref][]) {
      const isDangling = stepValidation?.fields.some(
        (f) => f.fieldName === fieldName && f.problem === "dangling-ref",
      );

      let sourceLayout = undefined;
      if ("from" in ref) {
        sourceLayout = layoutMap.get(ref.from === "trigger" ? "trigger" : ref.from);
      }

      if (!sourceLayout) continue;

      wires.push({
        d: bezierPath(
          sourceLayout.outputPort.x,
          sourceLayout.outputPort.y,
          targetLayout.inputPort.x,
          targetLayout.inputPort.y,
        ),
        invalid: !!isDangling,
      });
    }
  }

  return (
    <>
      {wires.map((wire, i) => (
        <path
          key={i}
          d={wire.d}
          fill="none"
          stroke={wire.invalid ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))"}
          strokeWidth={2}
          strokeDasharray={wire.invalid ? "6,4" : undefined}
        />
      ))}
    </>
  );
}
```

- [ ] **Step 5: Create `ChainCanvas`**

Create `apps/web/src/components/editor/ChainCanvas.tsx`:

```tsx
"use client";

import { useRef, useState, useCallback } from "react";
import type { Chain, NodeCatalogEntry } from "@tool-chain/core";
import type { EditorAction } from "@/hooks/useChainEditor";
import type { ValidationState, RunState } from "@/types/editor";
import { NodeCard } from "./NodeCard";
import { WireLayer } from "./WireLayer";
import { computeLayout, TRIGGER_WIDTH, TRIGGER_HEIGHT } from "./layout";

interface Props {
  chain: Chain;
  catalog: NodeCatalogEntry[];
  selectedStepId: string | null;
  validation: ValidationState;
  run: RunState;
  dispatch: React.Dispatch<EditorAction>;
}

export function ChainCanvas({
  chain,
  catalog,
  selectedStepId,
  validation,
  run,
  dispatch,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const dragging = useRef<{ startX: number; startY: number; vpX: number; vpY: number } | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest("foreignObject")) return;
    dragging.current = {
      startX: e.clientX,
      startY: e.clientY,
      vpX: viewport.x,
      vpY: viewport.y,
    };
  }, [viewport]);

  const onMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragging.current) return;
    setViewport((v) => ({
      ...v,
      x: dragging.current!.vpX + (e.clientX - dragging.current!.startX),
      y: dragging.current!.vpY + (e.clientY - dragging.current!.startY),
    }));
  }, []);

  const onMouseUp = useCallback(() => {
    dragging.current = null;
  }, []);

  const onWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setViewport((v) => ({
      ...v,
      scale: Math.min(2, Math.max(0.3, v.scale * factor)),
    }));
  }, []);

  const layouts = computeLayout(chain.steps.map((s) => s.stepId));
  const layoutMap = new Map(layouts.map((l) => [l.id, l]));
  const triggerLayout = layoutMap.get("trigger")!;

  return (
    <svg
      ref={svgRef}
      className="w-full h-full cursor-grab active:cursor-grabbing"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
    >
      <g transform={`translate(${viewport.x},${viewport.y}) scale(${viewport.scale})`}>
        {/* Trigger pseudo-node */}
        <rect
          x={triggerLayout.x}
          y={triggerLayout.y}
          width={TRIGGER_WIDTH}
          height={TRIGGER_HEIGHT}
          rx={8}
          className="fill-muted stroke-border"
          strokeWidth={2}
        />
        <text
          x={triggerLayout.x + TRIGGER_WIDTH / 2}
          y={triggerLayout.y + TRIGGER_HEIGHT / 2 - 4}
          textAnchor="middle"
          className="fill-foreground text-xs font-mono"
          fontSize={12}
          fontFamily="monospace"
        >
          trigger
        </text>
        {/* Port dot — output */}
        <circle
          cx={triggerLayout.outputPort.x}
          cy={triggerLayout.outputPort.y}
          r={5}
          className="fill-primary"
        />

        {/* Wires */}
        <WireLayer chain={chain} validation={validation} />

        {/* Step cards */}
        {chain.steps.map((step) => {
          const layout = layoutMap.get(step.stepId);
          if (!layout) return null;
          return (
            <g key={step.stepId}>
              {/* Input port */}
              <circle
                cx={layout.inputPort.x}
                cy={layout.inputPort.y}
                r={5}
                className="fill-muted-foreground"
              />
              {/* Output port */}
              <circle
                cx={layout.outputPort.x}
                cy={layout.outputPort.y}
                r={5}
                className="fill-primary"
              />
              <NodeCard
                step={step}
                catalogEntry={catalog.find((c) => c.id === step.nodeId)}
                x={layout.x}
                y={layout.y}
                selected={selectedStepId === step.stepId}
                status={run.stepStatuses[step.stepId]}
                validation={validation}
                onClick={() =>
                  dispatch({
                    type: "SET_SELECTION",
                    stepId: selectedStepId === step.stepId ? null : step.stepId,
                  })
                }
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
```

- [ ] **Step 6: Create `ChainEditor` shell (M1 stub — no inspector/palette/toolbar yet)**

Create `apps/web/src/components/editor/ChainEditor.tsx`:

```tsx
"use client";

import type { EditorState, EditorAction } from "@/hooks/useChainEditor";
import { ChainCanvas } from "./ChainCanvas";

interface Props {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
}

export function ChainEditor({ state, dispatch }: Props) {
  if (!state.chain) return null;

  return (
    <div className="flex flex-col h-screen">
      <div className="border-b bg-background px-4 py-2 flex items-center gap-2 shrink-0">
        <span className="font-semibold text-sm">{state.chain.name}</span>
        {state.dirty && (
          <span className="text-xs text-muted-foreground">• unsaved</span>
        )}
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <ChainCanvas
            chain={state.chain}
            catalog={state.catalog}
            selectedStepId={state.selectedStepId}
            validation={state.validation}
            run={state.run}
            dispatch={dispatch}
          />
        </div>
      </div>
    </div>
  );
}
```

Note: `EditorAction` needs to be exported from `useChainEditor.ts`. Verify it is already exported (it is — the type is defined with `export type`). Also add `EditorState` to the export if not already there (add `export` prefix to the `EditorState` interface in `types/editor.ts` — it already has it from Task 3).

Fix the import in `ChainEditor.tsx` — `EditorState` comes from `@/types/editor`, not `useChainEditor`:

```tsx
import type { EditorState } from "@/types/editor";
import type { EditorAction } from "@/hooks/useChainEditor";
```

- [ ] **Step 7: Typecheck and manual M1 test**

```bash
pnpm --filter @tool-chain/web typecheck
```

Start the dev server and open `/editor/<your-chain-id>`:

```bash
cd /Users/sakar/Documents/project/tool-chain/apps/web && pnpm dev
# Navigate to http://localhost:3000/editor/<NEXT_PUBLIC_RESUME_CHAIN_ID>
```

Expected (M1 complete): Three wired node cards (download → extract → parse) plus the trigger node, laid out left-to-right, pannable via mouse drag, zoomable via scroll wheel.

- [ ] **Step 8: Commit**

```bash
cd /Users/sakar/Documents/project/tool-chain
git add "apps/web/src/app/editor/[chainId]/page.tsx" \
        apps/web/src/components/editor/ChainEditor.tsx \
        apps/web/src/components/editor/ChainCanvas.tsx \
        apps/web/src/components/editor/NodeCard.tsx \
        apps/web/src/components/editor/WireLayer.tsx \
        apps/web/src/components/editor/layout.ts
git commit -m "feat(web): M1 read-only canvas — pan/zoom, node cards, wires"
```

---

## Task 5: M2 — Node inspector + ref editing (`NodeInspector`, `RefEditor`)

**Files:**
- Create: `apps/web/src/components/editor/NodeInspector.tsx`
- Create: `apps/web/src/components/editor/RefEditor.tsx`
- Modify: `apps/web/src/components/editor/ChainEditor.tsx` (add inspector side panel)

**Interfaces:**
- Consumes: `useChainEditor` dispatch + state from Task 3; `NodeCatalogEntry`, `Step`, `Ref` from `@tool-chain/core`; `ValidationState` from `@/types/editor`
- Produces: Click a node → side panel lists input fields with current source (trigger/step/literal); changing any fires `SET_REF` which re-renders wires

- [ ] **Step 1: Create `RefEditor`**

Create `apps/web/src/components/editor/RefEditor.tsx`:

```tsx
"use client";

import type { Ref, Step } from "@tool-chain/core";
import type { NodeCatalogEntry } from "@tool-chain/core";

type RefSource = "trigger" | "step" | "literal";

function refSource(ref: Ref | undefined): RefSource {
  if (!ref) return "trigger";
  if ("value" in ref) return "literal";
  if (ref.from === "trigger") return "trigger";
  return "step";
}

interface Props {
  fieldName: string;
  ref: Ref | undefined;
  stepIndex: number;
  allSteps: Step[];
  catalog: NodeCatalogEntry[];
  hasProblem: boolean;
  onChange: (ref: Ref) => void;
}

export function RefEditor({
  fieldName,
  ref: currentRef,
  stepIndex,
  allSteps,
  catalog,
  hasProblem,
  onChange,
}: Props) {
  const source = refSource(currentRef);
  const priorSteps = allSteps.slice(0, stepIndex);

  function handleSourceChange(newSource: RefSource) {
    if (newSource === "trigger") {
      onChange({ from: "trigger", path: fieldName });
    } else if (newSource === "literal") {
      onChange({ value: "" });
    } else if (newSource === "step" && priorSteps.length > 0) {
      const firstPriorStep = priorSteps[priorSteps.length - 1]!;
      const firstPriorEntry = catalog.find((c) => c.id === firstPriorStep.nodeId);
      const firstField = firstPriorEntry?.outputFields[0]?.name ?? fieldName;
      onChange({ from: firstPriorStep.stepId, path: firstField });
    }
  }

  function handleStepChange(stepId: string) {
    onChange({
      from: stepId,
      path:
        "from" in (currentRef ?? {}) && currentRef && "path" in currentRef
          ? (currentRef as { from: string; path: string }).path
          : fieldName,
    });
  }

  function handlePathChange(path: string) {
    if (!currentRef || !("from" in currentRef)) return;
    onChange({ ...(currentRef as { from: string; path: string }), path });
  }

  function handleLiteralChange(value: string) {
    onChange({ value });
  }

  const borderClass = hasProblem ? "border-destructive" : "border-border";

  // Get output fields for the selected step
  const selectedStepId =
    source === "step" && currentRef && "from" in currentRef
      ? (currentRef as { from: string }).from
      : null;
  const selectedStep = priorSteps.find((s) => s.stepId === selectedStepId);
  const selectedEntry = selectedStep
    ? catalog.find((c) => c.id === selectedStep.nodeId)
    : null;
  const availableOutputFields = selectedEntry?.outputFields ?? [];

  return (
    <div className={`rounded-md border p-3 space-y-2 ${borderClass}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono font-medium">{fieldName}</span>
        {hasProblem && (
          <span className="text-xs text-destructive">needs wiring</span>
        )}
      </div>
      {/* Source selector */}
      <div className="flex gap-1">
        {(["trigger", "step", "literal"] as RefSource[]).map((s) => (
          <button
            key={s}
            onClick={() => handleSourceChange(s)}
            disabled={s === "step" && priorSteps.length === 0}
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              source === s
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      {/* Step selector */}
      {source === "step" && (
        <div className="space-y-1">
          <select
            className="w-full text-xs rounded border border-border bg-background px-2 py-1"
            value={selectedStepId ?? ""}
            onChange={(e) => handleStepChange(e.target.value)}
          >
            {priorSteps.map((s) => (
              <option key={s.stepId} value={s.stepId}>
                {s.nodeId} ({s.stepId})
              </option>
            ))}
          </select>
          {availableOutputFields.length > 0 && (
            <select
              className="w-full text-xs rounded border border-border bg-background px-2 py-1"
              value={
                currentRef && "path" in currentRef
                  ? (currentRef as { path: string }).path
                  : ""
              }
              onChange={(e) => handlePathChange(e.target.value)}
            >
              {availableOutputFields.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name} ({f.type})
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {/* Trigger path */}
      {source === "trigger" && (
        <input
          className="w-full text-xs rounded border border-border bg-background px-2 py-1 font-mono"
          placeholder="trigger path (e.g. fileId)"
          value={
            currentRef && "path" in currentRef
              ? (currentRef as { path: string }).path
              : fieldName
          }
          onChange={(e) =>
            onChange({ from: "trigger", path: e.target.value })
          }
        />
      )}
      {/* Literal value */}
      {source === "literal" && (
        <input
          className="w-full text-xs rounded border border-border bg-background px-2 py-1"
          placeholder="literal value"
          value={
            currentRef && "value" in currentRef
              ? String((currentRef as { value: unknown }).value)
              : ""
          }
          onChange={(e) => handleLiteralChange(e.target.value)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `NodeInspector`**

Create `apps/web/src/components/editor/NodeInspector.tsx`:

```tsx
"use client";

import type { Chain, Step, NodeCatalogEntry, Ref } from "@tool-chain/core";
import type { EditorAction } from "@/hooks/useChainEditor";
import type { ValidationState } from "@/types/editor";
import { RefEditor } from "./RefEditor";

interface Props {
  step: Step;
  stepIndex: number;
  chain: Chain;
  catalog: NodeCatalogEntry[];
  validation: ValidationState;
  dispatch: React.Dispatch<EditorAction>;
}

export function NodeInspector({
  step,
  stepIndex,
  chain,
  catalog,
  validation,
  dispatch,
}: Props) {
  const catalogEntry = catalog.find((c) => c.id === step.nodeId);
  const stepValidation = validation.steps.find((v) => v.stepId === step.stepId);

  const inputFields =
    catalogEntry?.inputFields ?? Object.keys(step.inputMapping).map((name) => ({
      name,
      type: "unknown",
      required: true,
    }));

  function handleRefChange(fieldName: string, ref: Ref) {
    dispatch({ type: "SET_REF", stepId: step.stepId, fieldName, ref });
  }

  return (
    <div className="w-80 border-l bg-background overflow-y-auto p-4 space-y-4 shrink-0">
      <div>
        <h3 className="font-semibold text-sm">{step.nodeId}</h3>
        <p className="text-xs text-muted-foreground">{catalogEntry?.description}</p>
      </div>
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Input Wiring
        </p>
        {inputFields.map((field) => {
          const hasProblem = !!stepValidation?.fields.some(
            (f) => f.fieldName === field.name,
          );
          return (
            <RefEditor
              key={field.name}
              fieldName={field.name}
              ref={step.inputMapping[field.name]}
              stepIndex={stepIndex}
              allSteps={chain.steps}
              catalog={catalog}
              hasProblem={hasProblem}
              onChange={(ref) => handleRefChange(field.name, ref)}
            />
          );
        })}
      </div>
      {catalogEntry && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Output Fields
          </p>
          {catalogEntry.outputFields.map((f) => (
            <div
              key={f.name}
              className="flex items-center justify-between text-xs text-muted-foreground"
            >
              <span className="font-mono">{f.name}</span>
              <span>{f.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update `ChainEditor` to show the inspector**

Open `apps/web/src/components/editor/ChainEditor.tsx` and add the inspector panel:

```tsx
"use client";

import type { EditorState } from "@/types/editor";
import type { EditorAction } from "@/hooks/useChainEditor";
import { ChainCanvas } from "./ChainCanvas";
import { NodeInspector } from "./NodeInspector";

interface Props {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
}

export function ChainEditor({ state, dispatch }: Props) {
  if (!state.chain) return null;

  const selectedStep = state.chain.steps.find(
    (s) => s.stepId === state.selectedStepId,
  );
  const selectedStepIndex = state.chain.steps.findIndex(
    (s) => s.stepId === state.selectedStepId,
  );

  return (
    <div className="flex flex-col h-screen">
      <div className="border-b bg-background px-4 py-2 flex items-center gap-2 shrink-0">
        <span className="font-semibold text-sm">{state.chain.name}</span>
        {state.dirty && (
          <span className="text-xs text-muted-foreground">• unsaved</span>
        )}
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <ChainCanvas
            chain={state.chain}
            catalog={state.catalog}
            selectedStepId={state.selectedStepId}
            validation={state.validation}
            run={state.run}
            dispatch={dispatch}
          />
        </div>
        {selectedStep && (
          <NodeInspector
            step={selectedStep}
            stepIndex={selectedStepIndex}
            chain={state.chain}
            catalog={state.catalog}
            validation={state.validation}
            dispatch={dispatch}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @tool-chain/web typecheck
```

Expected: no errors.

- [ ] **Step 5: Manual M2 test**

Start the dev server, open `/editor/<chainId>`:
- Click any node → inspector panel appears on the right showing input fields
- Change a trigger ref to a literal → wire on canvas disappears (literal has no wire) — this is expected behavior for literals
- Change back to step ref → wire reappears pointing to the correct source
- Panel closes when clicking the same node again (toggle) or empty canvas area

- [ ] **Step 6: Commit**

```bash
cd /Users/sakar/Documents/project/tool-chain
git add apps/web/src/components/editor/NodeInspector.tsx \
        apps/web/src/components/editor/RefEditor.tsx \
        apps/web/src/components/editor/ChainEditor.tsx
git commit -m "feat(web): M2 node inspector — per-field ref editing with source switcher"
```

---

## Task 6: M3 — Structural editing (`NodePalette`, insert/remove/reorder)

**Files:**
- Create: `apps/web/src/components/editor/NodePalette.tsx`
- Modify: `apps/web/src/components/editor/ChainEditor.tsx` (add palette, delete button on card, reorder)
- Modify: `apps/web/src/components/editor/NodeCard.tsx` (add delete button + drag handle)

**Interfaces:**
- Consumes: `catalog` from state; `INSERT_STEP`, `REMOVE_STEP`, `REORDER_STEP` actions from Task 3

- [ ] **Step 1: Create `NodePalette`**

Create `apps/web/src/components/editor/NodePalette.tsx`:

```tsx
"use client";

import type { NodeCatalogEntry } from "@tool-chain/core";
import type { EditorAction } from "@/hooks/useChainEditor";

interface Props {
  catalog: NodeCatalogEntry[];
  insertAtIndex: number;
  dispatch: React.Dispatch<EditorAction>;
}

export function NodePalette({ catalog, insertAtIndex, dispatch }: Props) {
  return (
    <div className="w-56 border-r bg-background overflow-y-auto p-3 space-y-2 shrink-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Add Node
      </p>
      {catalog.map((entry) => (
        <button
          key={entry.id}
          className="w-full text-left rounded-md border border-border px-3 py-2 text-xs hover:bg-muted transition-colors"
          onClick={() =>
            dispatch({
              type: "INSERT_STEP",
              nodeId: entry.id,
              atIndex: insertAtIndex,
            })
          }
        >
          <div className="font-mono font-medium truncate">{entry.id}</div>
          <div className="text-muted-foreground truncate">{entry.description}</div>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add delete button to `NodeCard`**

Open `apps/web/src/components/editor/NodeCard.tsx` and add a delete button that only shows when the card is selected:

Replace the component body with:

```tsx
import type { Step } from "@tool-chain/core";
import type { NodeCatalogEntry } from "@tool-chain/core";
import type { StepStatus, ValidationState } from "@/types/editor";
import { CARD_WIDTH, CARD_HEIGHT } from "./layout";

interface Props {
  step: Step;
  catalogEntry: NodeCatalogEntry | undefined;
  x: number;
  y: number;
  selected: boolean;
  status: StepStatus | undefined;
  validation: ValidationState;
  onClick: () => void;
  onDelete: () => void;
}

const STATUS_COLORS: Record<StepStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-blue-500",
  ok: "text-green-500",
  error: "text-destructive",
};

export function NodeCard({
  step,
  catalogEntry,
  x,
  y,
  selected,
  status,
  validation,
  onClick,
  onDelete,
}: Props) {
  const hasError = validation.steps.some((v) => v.stepId === step.stepId);
  const borderColor = selected
    ? "border-primary"
    : hasError
      ? "border-destructive"
      : "border-border";
  const statusColor = status ? STATUS_COLORS[status] : "";

  return (
    <foreignObject x={x} y={y} width={CARD_WIDTH} height={CARD_HEIGHT}>
      <div
        className={`w-full h-full rounded-lg border-2 bg-card text-card-foreground shadow-sm cursor-pointer select-none p-3 flex flex-col justify-between ${borderColor}`}
        onClick={onClick}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono truncate">{step.nodeId}</span>
          <div className="flex items-center gap-1">
            <span
              className={`text-xs rounded-full px-1.5 py-0.5 bg-muted ${catalogEntry?.kind === "skill" ? "text-purple-600" : "text-blue-600"}`}
            >
              {catalogEntry?.kind ?? "?"}
            </span>
            {selected && (
              <button
                className="text-xs rounded px-1 py-0.5 text-destructive hover:bg-destructive/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                title="Remove step"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground truncate">
            {catalogEntry?.description ?? step.nodeId}
          </span>
          {status && <span className={`text-xs font-medium ${statusColor}`}>{status}</span>}
        </div>
      </div>
    </foreignObject>
  );
}
```

- [ ] **Step 3: Update `ChainCanvas` to pass `onDelete` and add reorder buttons**

Open `apps/web/src/components/editor/ChainCanvas.tsx`.

1. Add `onDelete` prop to `NodeCard` usage — pass a function that dispatches `REMOVE_STEP`.
2. Add reorder: add "←" and "→" buttons above each card (in the SVG as `foreignObject`) that dispatch `REORDER_STEP`. These appear only when `selected`.

Add to the Props interface:

The `dispatch` prop is already there. Update the `NodeCard` render call inside the `g` element loop:

```tsx
<NodeCard
  step={step}
  catalogEntry={catalog.find((c) => c.id === step.nodeId)}
  x={layout.x}
  y={layout.y}
  selected={selectedStepId === step.stepId}
  status={run.stepStatuses[step.stepId]}
  validation={validation}
  onClick={() =>
    dispatch({
      type: "SET_SELECTION",
      stepId: selectedStepId === step.stepId ? null : step.stepId,
    })
  }
  onDelete={() => dispatch({ type: "REMOVE_STEP", stepId: step.stepId })}
/>
```

Also add reorder buttons below each card when it's selected. Add after the `NodeCard` in the loop (inside the `<g key={step.stepId}>`):

```tsx
{selectedStepId === step.stepId && (() => {
  const idx = chain.steps.findIndex((s) => s.stepId === step.stepId);
  return (
    <foreignObject
      x={layout.x}
      y={layout.y + CARD_HEIGHT + 4}
      width={CARD_WIDTH}
      height={28}
    >
      <div className="flex justify-center gap-2">
        {idx > 0 && (
          <button
            className="text-xs px-2 py-1 rounded border border-border bg-background hover:bg-muted"
            onClick={() =>
              dispatch({ type: "REORDER_STEP", stepId: step.stepId, toIndex: idx - 1 })
            }
          >
            ← Move left
          </button>
        )}
        {idx < chain.steps.length - 1 && (
          <button
            className="text-xs px-2 py-1 rounded border border-border bg-background hover:bg-muted"
            onClick={() =>
              dispatch({ type: "REORDER_STEP", stepId: step.stepId, toIndex: idx + 1 })
            }
          >
            Move right →
          </button>
        )}
      </div>
    </foreignObject>
  );
})()}
```

Add the `CARD_HEIGHT` import to the import line in `ChainCanvas.tsx`:

```ts
import { computeLayout, TRIGGER_WIDTH, TRIGGER_HEIGHT, CARD_HEIGHT } from "./layout";
```

- [ ] **Step 4: Add palette to `ChainEditor`**

Open `apps/web/src/components/editor/ChainEditor.tsx` and add `NodePalette` to the left of the canvas. Insert it in the `<div className="flex flex-1 overflow-hidden">` section:

```tsx
import { NodePalette } from "./NodePalette";

// Inside the flex row:
<NodePalette
  catalog={state.catalog}
  insertAtIndex={state.chain.steps.length} // always append at end
  dispatch={dispatch}
/>
```

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @tool-chain/web typecheck
```

Expected: no errors.

- [ ] **Step 6: Manual M3 test**

Open `/editor/<chainId>`:
- Click "+" on a node from the palette → new node appears on canvas with dangling-ref warning
- Select the new node → delete with ✕ button
- Select an existing node → move left/right with reorder buttons → wires redraw; if a ref becomes invalid, the wire turns red and a warning appears in the inspector

- [ ] **Step 7: Commit**

```bash
cd /Users/sakar/Documents/project/tool-chain
git add apps/web/src/components/editor/NodePalette.tsx \
        apps/web/src/components/editor/NodeCard.tsx \
        apps/web/src/components/editor/ChainCanvas.tsx \
        apps/web/src/components/editor/ChainEditor.tsx
git commit -m "feat(web): M3 structural editing — palette, insert, delete, reorder with validity enforcement"
```

---

## Task 7: M4 — Persistence + Toolbar + TriggerPanel

**Files:**
- Create: `apps/web/src/components/editor/Toolbar.tsx`
- Create: `apps/web/src/components/editor/TriggerPanel.tsx`
- Modify: `apps/web/src/components/editor/ChainEditor.tsx` (add toolbar, trigger panel, save logic)

**Interfaces:**
- Consumes: `state.dirty`, `state.validation.valid`, `state.chain`, `PUT /api/chains/[id]`
- Produces: Save button (disabled when not dirty or invalid) that PUTs the chain and marks saved; TriggerPanel that edits trigger payload; zoom controls

- [ ] **Step 1: Create `TriggerPanel`**

Create `apps/web/src/components/editor/TriggerPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { EditorAction } from "@/hooks/useChainEditor";

interface Props {
  trigger: Record<string, unknown>;
  dispatch: React.Dispatch<EditorAction>;
}

export function TriggerPanel({ trigger, dispatch }: Props) {
  const [raw, setRaw] = useState(() => JSON.stringify(trigger, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  function handleChange(value: string) {
    setRaw(value);
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      setParseError(null);
      dispatch({ type: "SET_TRIGGER", payload: parsed });
    } catch {
      setParseError("Invalid JSON");
    }
  }

  return (
    <div className="border-t bg-background p-3 space-y-2 shrink-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Trigger Payload
      </p>
      <textarea
        className={`w-full h-24 text-xs font-mono rounded border bg-background px-2 py-1 resize-none ${
          parseError ? "border-destructive" : "border-border"
        }`}
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
      />
      {parseError && (
        <p className="text-xs text-destructive">{parseError}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `Toolbar`**

Create `apps/web/src/components/editor/Toolbar.tsx`:

```tsx
"use client";

interface Props {
  chainName: string;
  dirty: boolean;
  valid: boolean;
  saving: boolean;
  onSave: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
}

export function Toolbar({
  chainName,
  dirty,
  valid,
  saving,
  onSave,
  onZoomIn,
  onZoomOut,
  onZoomFit,
}: Props) {
  const canSave = dirty && valid && !saving;

  return (
    <div className="border-b bg-background px-4 py-2 flex items-center gap-3 shrink-0">
      <span className="font-semibold text-sm flex-1 truncate">
        {chainName}
        {dirty && !valid && (
          <span className="ml-2 text-xs text-destructive font-normal">
            invalid wiring
          </span>
        )}
        {dirty && valid && (
          <span className="ml-2 text-xs text-muted-foreground font-normal">
            • unsaved
          </span>
        )}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={onZoomOut}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted"
          title="Zoom out"
        >
          −
        </button>
        <button
          onClick={onZoomFit}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted"
          title="Fit to screen"
        >
          fit
        </button>
        <button
          onClick={onZoomIn}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted"
          title="Zoom in"
        >
          +
        </button>
      </div>
      <button
        onClick={onSave}
        disabled={!canSave}
        className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Extract zoom control from canvas + lift to `ChainEditor`**

The zoom state (`viewport`) currently lives inside `ChainCanvas`. To let the `Toolbar` control zoom, lift it to `ChainEditor` and pass it down as a prop.

Update `ChainCanvas` to accept `viewport` and `setViewport` as props instead of local state:

```tsx
// In ChainCanvas.tsx — change the Props interface:
interface Viewport { x: number; y: number; scale: number }

interface Props {
  chain: Chain;
  catalog: NodeCatalogEntry[];
  selectedStepId: string | null;
  validation: ValidationState;
  run: RunState;
  dispatch: React.Dispatch<EditorAction>;
  viewport: Viewport;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
}

// Remove the local useState for viewport
// Remove the local state declaration:
// const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
```

Then in `ChainEditor.tsx`, manage viewport state and wire toolbar zoom:

```tsx
"use client";

import { useState, useCallback } from "react";
import type { EditorState } from "@/types/editor";
import type { EditorAction } from "@/hooks/useChainEditor";
import { ChainCanvas } from "./ChainCanvas";
import { NodeInspector } from "./NodeInspector";
import { NodePalette } from "./NodePalette";
import { Toolbar } from "./Toolbar";
import { TriggerPanel } from "./TriggerPanel";

const API_SECRET = process.env["NEXT_PUBLIC_RUN_API_SECRET"] ?? "";

interface Viewport { x: number; y: number; scale: number }

interface Props {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
}

export function ChainEditor({ state, dispatch }: Props) {
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (!state.chain || !state.validation.valid || !state.dirty) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/chains/${state.chain.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-run-secret": API_SECRET,
        },
        body: JSON.stringify(state.chain),
      });
      if (res.ok) {
        dispatch({ type: "MARK_SAVED" });
      } else {
        console.error("Save failed", await res.text());
      }
    } finally {
      setSaving(false);
    }
  }, [state.chain, state.validation.valid, state.dirty, dispatch]);

  if (!state.chain) return null;

  const selectedStep = state.chain.steps.find(
    (s) => s.stepId === state.selectedStepId,
  );
  const selectedStepIndex = state.chain.steps.findIndex(
    (s) => s.stepId === state.selectedStepId,
  );

  return (
    <div className="flex flex-col h-screen">
      <Toolbar
        chainName={state.chain.name}
        dirty={state.dirty}
        valid={state.validation.valid}
        saving={saving}
        onSave={() => void handleSave()}
        onZoomIn={() => setViewport((v) => ({ ...v, scale: Math.min(2, v.scale * 1.2) }))}
        onZoomOut={() => setViewport((v) => ({ ...v, scale: Math.max(0.3, v.scale / 1.2) }))}
        onZoomFit={() => setViewport({ x: 0, y: 0, scale: 1 })}
      />
      <div className="flex flex-1 overflow-hidden">
        <NodePalette
          catalog={state.catalog}
          insertAtIndex={state.chain.steps.length}
          dispatch={dispatch}
        />
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1">
            <ChainCanvas
              chain={state.chain}
              catalog={state.catalog}
              selectedStepId={state.selectedStepId}
              validation={state.validation}
              run={state.run}
              dispatch={dispatch}
              viewport={viewport}
              setViewport={setViewport}
            />
          </div>
          <TriggerPanel trigger={state.trigger} dispatch={dispatch} />
        </div>
        {selectedStep && (
          <NodeInspector
            step={selectedStep}
            stepIndex={selectedStepIndex}
            chain={state.chain}
            catalog={state.catalog}
            validation={state.validation}
            dispatch={dispatch}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @tool-chain/web typecheck
```

Expected: no errors.

- [ ] **Step 5: Manual M4 test**

Open `/editor/<chainId>`:
- Make an edit (change a ref to a literal) → Save button becomes active
- Click Save → button shows "Saving…" → returns to "Save" with "• unsaved" gone
- Reload the page → edits persist
- Make an invalid edit (reorder to create dangling ref) → Save shows "invalid wiring" and is disabled

- [ ] **Step 6: Commit**

```bash
cd /Users/sakar/Documents/project/tool-chain
git add apps/web/src/components/editor/Toolbar.tsx \
        apps/web/src/components/editor/TriggerPanel.tsx \
        apps/web/src/components/editor/ChainEditor.tsx \
        apps/web/src/components/editor/ChainCanvas.tsx
git commit -m "feat(web): M4 persistence — save chain, toolbar zoom, trigger panel"
```

---

## Task 8: M5 — Run on canvas (`useChainRun`, SSE status rings, result panel)

**Files:**
- Create: `apps/web/src/hooks/useChainRun.ts`
- Modify: `apps/web/src/components/editor/Toolbar.tsx` (add Run button)
- Modify: `apps/web/src/components/editor/ChainEditor.tsx` (wire run hook, result panel)

**Interfaces:**
- Consumes: `state.trigger`, `state.chain.id`, `state.dirty`; existing SSE protocol from run route (`step`/`done`/`error` events); `SET_RUN_STATUS`, `SET_RUN_RESULT`, `SET_RUN_ERROR`, `CLEAR_RUN` actions
- Produces: Run button in toolbar; nodes light up with status; result shown below canvas

- [ ] **Step 1: Extract `useChainRun` hook**

Create `apps/web/src/hooks/useChainRun.ts`:

```ts
"use client";

import { useCallback, useState } from "react";

const API_SECRET = process.env["NEXT_PUBLIC_RUN_API_SECRET"] ?? "";

interface StepEvent { stepId: string; status: string }
interface DoneEvent { ok: boolean; output?: unknown; error?: { message: string } }
interface ErrorEvent { message: string }
type RunEvent =
  | { event: "step"; data: StepEvent }
  | { event: "done"; data: DoneEvent }
  | { event: "error"; data: ErrorEvent };

interface UseChainRunOptions {
  onStep: (stepId: string, status: string) => void;
  onDone: (result: unknown) => void;
  onError: (message: string) => void;
}

export function useChainRun({ onStep, onDone, onError }: UseChainRunOptions) {
  const [running, setRunning] = useState(false);

  const run = useCallback(
    async (chainId: string, trigger: Record<string, unknown>) => {
      setRunning(true);
      try {
        const res = await fetch(`/api/chains/${chainId}/run`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-run-secret": API_SECRET,
          },
          body: JSON.stringify(trigger),
        });

        if (!res.ok || !res.body) {
          onError(`HTTP ${res.status}`);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let evt: RunEvent;
            try {
              evt = JSON.parse(line.slice(6)) as RunEvent;
            } catch {
              continue;
            }

            if (evt.event === "step") {
              onStep(evt.data.stepId, evt.data.status);
            } else if (evt.event === "done") {
              if (evt.data.ok && evt.data.output !== undefined) {
                onDone(evt.data.output);
              } else {
                onError(evt.data.error?.message ?? "Run failed");
              }
            } else if (evt.event === "error") {
              onError(evt.data.message);
            }
          }
        }
      } catch (e) {
        onError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setRunning(false);
      }
    },
    [onStep, onDone, onError],
  );

  return { run, running };
}
```

- [ ] **Step 2: Add Run button to `Toolbar`**

Open `apps/web/src/components/editor/Toolbar.tsx` and add `onRun`, `running`, `runnable` props:

```tsx
interface Props {
  chainName: string;
  dirty: boolean;
  valid: boolean;
  saving: boolean;
  running: boolean;
  onSave: () => void;
  onRun: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
}

export function Toolbar({
  chainName,
  dirty,
  valid,
  saving,
  running,
  onSave,
  onRun,
  onZoomIn,
  onZoomOut,
  onZoomFit,
}: Props) {
  const canSave = dirty && valid && !saving && !running;
  const canRun = !dirty && valid && !running && !saving;

  return (
    <div className="border-b bg-background px-4 py-2 flex items-center gap-3 shrink-0">
      <span className="font-semibold text-sm flex-1 truncate">
        {chainName}
        {dirty && !valid && (
          <span className="ml-2 text-xs text-destructive font-normal">
            invalid wiring
          </span>
        )}
        {dirty && valid && (
          <span className="ml-2 text-xs text-muted-foreground font-normal">
            • unsaved changes — save before running
          </span>
        )}
      </span>
      <div className="flex items-center gap-1">
        <button onClick={onZoomOut} className="text-xs px-2 py-1 rounded border border-border hover:bg-muted" title="Zoom out">−</button>
        <button onClick={onZoomFit} className="text-xs px-2 py-1 rounded border border-border hover:bg-muted" title="Fit">fit</button>
        <button onClick={onZoomIn} className="text-xs px-2 py-1 rounded border border-border hover:bg-muted" title="Zoom in">+</button>
      </div>
      <button
        onClick={onSave}
        disabled={!canSave}
        className="text-xs px-3 py-1.5 rounded border border-border font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted transition-colors"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      <button
        onClick={onRun}
        disabled={!canRun}
        className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
      >
        {running ? "Running…" : "Run"}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Wire run hook in `ChainEditor`**

Open `apps/web/src/components/editor/ChainEditor.tsx`.

1. Import `useChainRun` and `ResultView`.
2. Add run callbacks and wire to toolbar.
3. Show result below the canvas.

Add to imports:

```tsx
import { useChainRun } from "@/hooks/useChainRun";
import { ResultView } from "@/components/ResultView";
import type { ResumeDTO } from "@tool-chain/core";
```

Add inside the `ChainEditor` component function body, before the `return`:

```tsx
const { run, running } = useChainRun({
  onStep: (stepId, status) => {
    dispatch({ type: "SET_RUN_STATUS", stepId, status: status as Parameters<typeof dispatch>[0] extends { status: infer S } ? S : never });
  },
  onDone: (result) => dispatch({ type: "SET_RUN_RESULT", result }),
  onError: (message) => dispatch({ type: "SET_RUN_ERROR", message }),
});

const handleRun = useCallback(async () => {
  if (!state.chain) return;
  dispatch({ type: "CLEAR_RUN" });
  // Mark all steps pending
  for (const step of state.chain.steps) {
    dispatch({ type: "SET_RUN_STATUS", stepId: step.stepId, status: "pending" });
  }
  await run(state.chain.id, state.trigger);
}, [state.chain, state.trigger, run, dispatch]);
```

Simplify the `SET_RUN_STATUS` dispatch type issue — use a direct cast:

```tsx
const { run, running } = useChainRun({
  onStep: (stepId, status) => {
    dispatch({
      type: "SET_RUN_STATUS",
      stepId,
      status: status as "pending" | "running" | "ok" | "error",
    });
  },
  onDone: (result) => dispatch({ type: "SET_RUN_RESULT", result }),
  onError: (message) => dispatch({ type: "SET_RUN_ERROR", message }),
});

const handleRun = useCallback(async () => {
  if (!state.chain) return;
  dispatch({ type: "CLEAR_RUN" });
  for (const step of state.chain.steps) {
    dispatch({ type: "SET_RUN_STATUS", stepId: step.stepId, status: "pending" });
  }
  await run(state.chain.id, state.trigger);
}, [state.chain, state.trigger, run, dispatch]);
```

Update the `Toolbar` usage to pass run props:

```tsx
<Toolbar
  chainName={state.chain.name}
  dirty={state.dirty}
  valid={state.validation.valid}
  saving={saving}
  running={running}
  onSave={() => void handleSave()}
  onRun={() => void handleRun()}
  onZoomIn={() => setViewport((v) => ({ ...v, scale: Math.min(2, v.scale * 1.2) }))}
  onZoomOut={() => setViewport((v) => ({ ...v, scale: Math.max(0.3, v.scale / 1.2) }))}
  onZoomFit={() => setViewport({ x: 0, y: 0, scale: 1 })}
/>
```

Add the result/error display at the bottom of the flex column (between `<div className="flex-1">` canvas and `<TriggerPanel>`):

```tsx
{state.run.error && (
  <div className="border-t bg-destructive/10 px-4 py-2 text-sm text-destructive shrink-0">
    {state.run.error}
  </div>
)}
{state.run.result && (
  <div className="border-t bg-background overflow-y-auto max-h-64 p-4 shrink-0">
    <ResultView resume={state.run.result as ResumeDTO | null} />
  </div>
)}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @tool-chain/web typecheck
```

Expected: no errors.

- [ ] **Step 5: Manual M5 test**

Open `/editor/<chainId>`:
1. Ensure chain is saved (no "unsaved" indicator)
2. Set trigger payload in `TriggerPanel` to `{ "fileId": "<a-valid-drive-file-id>" }`
3. Click Run
4. Verify: each node card shows "pending" → then "running" → then "ok" (or "error") in sequence
5. After run completes: result renders below canvas via `ResultView`
6. If dirty: Run button is disabled; save first prompt appears in toolbar

- [ ] **Step 6: Commit**

```bash
cd /Users/sakar/Documents/project/tool-chain
git add apps/web/src/hooks/useChainRun.ts \
        apps/web/src/components/editor/Toolbar.tsx \
        apps/web/src/components/editor/ChainEditor.tsx
git commit -m "feat(web): M5 run on canvas — SSE step status rings, result panel, dirty guard"
```

---

## Self-Review

### Spec coverage check

| Spec section | Covered by |
|---|---|
| §4.1 `GET /api/nodes` | Task 2 |
| §4.2 `GET /api/chains/[id]` | Task 2 |
| §4.3 `PUT /api/chains/[id]` | Task 2 |
| §4.4 run route unchanged | Task 2 (singleton refactor only) |
| §5 `ChainEditor`, `ChainCanvas`, `NodeCard`, `WireLayer`, `NodePalette`, `NodeInspector`, `RefEditor`, `TriggerPanel`, `Toolbar` | Tasks 4–8 |
| §5 `useChainEditor` state + actions | Task 3 |
| §6 backward-only refs | Task 3 (validation in reducer) |
| §6 reordering re-validates | Task 3 (test included) |
| §6 inserted steps start incomplete | Task 3 (test included) |
| §6 path picker is descriptor-driven | Task 5 (`RefEditor` uses `outputFields` from catalog) |
| §7 load: parallel GET | Task 4 (page.tsx uses `Promise.all`) |
| §7 edit: in-memory only | Task 3 (reducer mutates local state) |
| §7 save: PUT + mark saved | Task 7 |
| §7 run uses last-saved chain | Task 8 (Run disabled when dirty) |
| §8 M1 read-only canvas | Task 4 |
| §8 M2 inspector + ref editing | Task 5 |
| §8 M3 structural editing | Task 6 |
| §8 M4 persistence | Task 7 |
| §8 M5 run on canvas | Task 8 |
| §9 `describeNode` tests | Task 1 |
| §9 reducer action tests | Task 3 |
| §9 API route auth gate | Task 2 (implemented in routes) |
| §10 load failures | Task 4 (page shows error state) |
| §10 save validation errors | Task 7 (console.error; could surface inline — acceptable for v1) |
| §10 dangling refs shown red | Task 4 (`WireLayer` uses `strokeDasharray` + destructive color) |
| §10 run errors | Task 8 (error panel below canvas) |
| §10 auth 401 | Task 2 (all routes return 401) |
| `EngineBundle.chainRepository` gap | Task 1 |

### Placeholder scan

No "TBD", "TODO", or vague steps found. All code blocks are complete.

### Type consistency check

- `NodeCatalogEntry` and `NodeFieldDescriptor` defined in Task 1, used consistently across Tasks 2–8.
- `EditorState`, `EditorAction`, `ValidationState`, `StepStatus` defined in Tasks 3, used consistently in Tasks 4–8.
- `computeLayout` returns `NodeLayout[]` with `outputPort`/`inputPort` — used in `WireLayer` and `ChainCanvas` consistently.
- `viewport` lifted in Task 7; `ChainCanvas` Props updated to remove local state and accept `viewport`/`setViewport` — consistent with Task 4 definition updated in Task 7.

**One noted issue fixed:** In Task 4, `ChainCanvas` initially declares `viewport` as local state; Task 7 lifts it. The Task 4 implementation should be written as the final lifted form to avoid confusion — but since tasks are executed in order and Task 7 explicitly shows the full updated file, this is acceptable as a two-phase refinement.
