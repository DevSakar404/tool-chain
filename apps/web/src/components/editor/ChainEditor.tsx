"use client";

import { useState, useCallback } from "react";
import type { ResumeDTO } from "@tool-chain/core";
import type { EditorState } from "@/types/editor";
import type { EditorAction } from "@/hooks/useChainEditor";
import { useChainRun } from "@/hooks/useChainRun";
import { ChainCanvas } from "./ChainCanvas";
import { NodeInspector } from "./NodeInspector";
import { NodePalette } from "./NodePalette";
import { Toolbar } from "./Toolbar";
import { TriggerPanel } from "./TriggerPanel";
import { ResultView } from "@/components/ResultView";

const API_SECRET = process.env["NEXT_PUBLIC_RUN_API_SECRET"] ?? "";

interface Viewport { x: number; y: number; scale: number }

interface Props {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
}

export function ChainEditor({ state, dispatch }: Props) {
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [saving, setSaving] = useState(false);

  const onStep = useCallback(
    (stepId: string, status: string) =>
      dispatch({ type: "SET_RUN_STATUS", stepId, status: status as "pending" | "running" | "ok" | "error" }),
    [dispatch],
  );
  const onDone = useCallback(
    (result: unknown, totalTokens?: number) =>
      dispatch({ type: "SET_RUN_RESULT", result, ...(totalTokens !== undefined ? { totalTokens } : {}) }),
    [dispatch],
  );
  const onError = useCallback((message: string) => dispatch({ type: "SET_RUN_ERROR", message }), [dispatch]);

  const { run, running } = useChainRun({ onStep, onDone, onError });

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

  const handleRun = useCallback(async () => {
    if (!state.chain) return;
    dispatch({ type: "CLEAR_RUN" });
    dispatch({ type: "RUN_START" });
    for (const step of state.chain.steps) {
      dispatch({ type: "SET_RUN_STATUS", stepId: step.stepId, status: "pending" });
    }
    await run(state.chain.id, state.trigger);
  }, [state.chain, state.trigger, run, dispatch]);

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
        running={running}
        onSave={() => void handleSave()}
        onRun={() => void handleRun()}
        onZoomIn={() => setViewport((v) => ({ ...v, scale: Math.min(2, v.scale * 1.2) }))}
        onZoomOut={() => setViewport((v) => ({ ...v, scale: Math.max(0.4, v.scale / 1.2) }))}
        onZoomFit={() => setViewport({ x: 0, y: 0, scale: 1 })}
      />
      <div className="flex flex-1 overflow-hidden">
        <NodePalette
          catalog={state.catalog}
          insertAtIndex={state.chain.steps.length}
          dispatch={dispatch}
        />
        {/* Canvas + bottom panels + inspector overlay */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          <div className="flex-1 relative overflow-hidden w-full h-full flex flex-col">
            <ChainCanvas
              chain={state.chain}
              catalog={state.catalog}
              selectedStepId={state.selectedStepId}
              validation={state.validation}
              run={state.run}
              dispatch={dispatch}
              viewport={viewport}
              setViewport={setViewport}
              onSave={() => void handleSave()}
              onRun={() => void handleRun()}
              onZoomIn={() => setViewport((v) => ({ ...v, scale: Math.min(2, v.scale * 1.2) }))}
              onZoomOut={() => setViewport((v) => ({ ...v, scale: Math.max(0.4, v.scale / 1.2) }))}
              onZoomFit={() => setViewport({ x: 0, y: 0, scale: 1 })}
            />
            {/* Inspector drawer — overlays the canvas from the right */}
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
          {state.run.error && (
            <div className="border-t bg-destructive/10 px-4 py-2 text-sm text-destructive shrink-0">
              {state.run.error}
            </div>
          )}
          {state.run.result != null && (
            <div className="border-t bg-background overflow-y-auto max-h-64 p-4 shrink-0">
              {state.run.totalTokens != null && state.run.totalTokens > 0 && (
                <p className="mb-3 text-xs text-muted-foreground">
                  ≈ {state.run.totalTokens.toLocaleString()} tokens
                </p>
              )}
              <ResultView resume={state.run.result as ResumeDTO | null} />
            </div>
          )}
          <TriggerPanel trigger={state.trigger} dispatch={dispatch} />
        </div>
      </div>

    </div>
  );
}
