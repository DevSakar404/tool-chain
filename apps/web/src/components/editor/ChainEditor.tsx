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
