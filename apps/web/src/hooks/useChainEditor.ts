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
  | { type: "RUN_START" }
  | { type: "SET_RUN_STATUS"; stepId: string; status: StepStatus }
  | { type: "SET_RUN_RESULT"; result: unknown }
  | { type: "SET_RUN_ERROR"; message: string }
  | { type: "CLEAR_RUN" }
  | { type: "LOAD_ERROR"; message: string };

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

      // Both TriggerRef and StepRef have a `from` field
      const stepOrTriggerRef = ref as { from: string; path: string };
      if (stepOrTriggerRef.from === "trigger") continue; // trigger ref — always valid

      // step ref: check that 'from' exists and is strictly earlier
      const fromIndex = chain.steps.findIndex((s) => s.stepId === stepOrTriggerRef.from);
      if (!stepIds.has(stepOrTriggerRef.from) || fromIndex >= i) {
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
      return { ...state, trigger: action.payload, dirty: true };

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
      const inputMapping: Record<string, Ref> = {};
      // Seed with empty inputMapping — validation will flag required fields as needs-wiring
      const newStep = {
        stepId: `step-${crypto.randomUUID().slice(0, 8)}`,
        nodeId: action.nodeId,
        inputMapping,
      };
      const steps = [...state.chain.steps];
      steps.splice(action.atIndex, 0, newStep);
      const chain = { ...state.chain, steps };
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

    case "RUN_START":
      return {
        ...state,
        run: { active: true, stepStatuses: {}, result: null, error: null },
      };

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

    case "LOAD_ERROR":
      return { ...state, loadError: action.message };

    default:
      return state;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useChainEditor() {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  return { state, dispatch };
}
