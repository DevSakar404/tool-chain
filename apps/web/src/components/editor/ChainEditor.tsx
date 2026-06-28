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
