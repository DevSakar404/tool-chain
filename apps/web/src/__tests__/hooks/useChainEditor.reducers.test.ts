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
    expect(state.chain?.steps[0]?.stepId).toBe("s2");
    expect(state.chain?.steps[1]?.stepId).toBe("s1");
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
    expect(s2Validation?.fields.every((f) => f.problem === "dangling-ref")).toBe(true);
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
    expect(state.chain?.steps[0]?.nodeId).toBe("drive.download_file");
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

describe("editorReducer — SET_TRIGGER", () => {
  it("updates the trigger payload", () => {
    const state = editorReducer(loadedState(), {
      type: "SET_TRIGGER",
      payload: { fileId: "abc123" },
    });
    expect(state.trigger).toEqual({ fileId: "abc123" });
  });

  it("does NOT mark the chain dirty (trigger is run-time input, not persisted)", () => {
    // Regression guard: a dirty chain disables the Run button, and editing the
    // trigger must not block Run.
    const state = editorReducer(loadedState(), {
      type: "SET_TRIGGER",
      payload: { fileId: "abc123" },
    });
    expect(state.dirty).toBe(false);
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
