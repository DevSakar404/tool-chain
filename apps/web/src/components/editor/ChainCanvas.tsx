"use client";

import { useRef, useCallback, useEffect, useId } from "react";
import type { Chain, NodeCatalogEntry } from "@tool-chain/core";
import type { EditorAction } from "@/hooks/useChainEditor";
import type { ValidationState, RunState } from "@/types/editor";
import { NodeCard } from "./NodeCard";
import { WireLayer } from "./WireLayer";
import { computeLayout, TRIGGER_WIDTH, TRIGGER_HEIGHT, CARD_WIDTH, CARD_HEADER_HEIGHT, FIELD_ROW_HEIGHT } from "./layout";

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
  onOpenInspector?: () => void;
  onCloseInspector?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomFit?: () => void;
  onSave?: () => void;
  onRun?: () => void;
}

export function ChainCanvas({
  chain,
  catalog,
  selectedStepId,
  validation,
  run,
  dispatch,
  viewport,
  setViewport,
  onOpenInspector,
  onCloseInspector,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onSave,
  onRun,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<{ startX: number; startY: number; vpX: number; vpY: number } | null>(null);
  const dotPatternId = useId();

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
    const drag = dragging.current;
    if (!drag) return;
    setViewport((v) => ({
      ...v,
      x: drag.vpX + (e.clientX - drag.startX),
      y: drag.vpY + (e.clientY - drag.startY),
    }));
  }, [setViewport]);

  const onMouseUp = useCallback(() => {
    dragging.current = null;
  }, []);

  const onWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setViewport((v) => ({
      ...v,
      scale: Math.min(2, Math.max(0.4, v.scale * factor)),
    }));
  }, [setViewport]);

  // Keyboard shortcuts — attached to document so focus inside foreignObject buttons doesn't break them
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Don't hijack events from text inputs, selects, or textareas
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key === "s") { e.preventDefault(); onSave?.(); return; }
      if (meta && e.key === "Enter") { e.preventDefault(); onRun?.(); return; }
      if (e.key === "=" || e.key === "+") { e.preventDefault(); onZoomIn?.(); return; }
      if (e.key === "-") { e.preventDefault(); onZoomOut?.(); return; }
      if (e.key === "0") { e.preventDefault(); onZoomFit?.(); return; }

      if (e.key === "Escape") {
        onCloseInspector?.();
        dispatch({ type: "SET_SELECTION", stepId: null });
        return;
      }
      if (e.key === "Enter" && !meta) {
        if (selectedStepId) { onOpenInspector?.(); }
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedStepId) {
        e.preventDefault();
        dispatch({ type: "REMOVE_STEP", stepId: selectedStepId });
        return;
      }

      // Tab cycles through nodes
      if (e.key === "Tab") {
        e.preventDefault();
        const ids = chain.steps.map((s) => s.stepId);
        if (ids.length === 0) return;
        const currentIdx = ids.indexOf(selectedStepId ?? "");
        const nextIdx = e.shiftKey
          ? (currentIdx - 1 + ids.length) % ids.length
          : (currentIdx + 1) % ids.length;
        dispatch({ type: "SET_SELECTION", stepId: ids[nextIdx]! });
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedStepId, chain.steps, dispatch, onSave, onRun, onZoomIn, onZoomOut, onZoomFit, onOpenInspector, onCloseInspector]);

  const layouts = computeLayout(chain.steps, catalog);
  const layoutMap = new Map(layouts.map((l) => [l.id, l]));
  const triggerLayout = layoutMap.get("trigger")!;

  // Dot opacity scales down as you zoom out so they fade at low zoom
  const dotOpacity = Math.min(1, Math.max(0, (viewport.scale - 0.4) / 0.6));

  return (
    <div className="relative w-full h-full overflow-hidden flex-1 flex flex-col">
      <svg
      ref={svgRef}
      aria-label="Chain editor canvas"
      role="application"
      className="w-full h-full cursor-grab active:cursor-grabbing"
      style={{ background: "hsl(var(--canvas-bg))" }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
    >
      <defs>
        {/* 20px dot grid pattern */}
        <pattern
          id={dotPatternId}
          x="0"
          y="0"
          width="20"
          height="20"
          patternUnits="userSpaceOnUse"
          patternTransform={`translate(${viewport.x % 20},${viewport.y % 20})`}
        >
          <circle
            cx="1"
            cy="1"
            r="0.8"
            fill="hsl(var(--canvas-dot))"
            opacity={dotOpacity}
          />
        </pattern>
      </defs>

      {/* Dot grid backdrop */}
      <rect width="100%" height="100%" fill={`url(#${dotPatternId})`} aria-hidden="true" />

      <g transform={`translate(${viewport.x},${viewport.y}) scale(${viewport.scale})`}>
        {/* Trigger pseudo-node */}
        <rect
          x={triggerLayout.x}
          y={triggerLayout.y}
          width={TRIGGER_WIDTH}
          height={TRIGGER_HEIGHT}
          rx={8}
          fill="hsl(var(--card))"
          stroke="hsl(var(--kind-trigger))"
          strokeWidth={2}
        />
        {/* Trigger kind rail */}
        <rect
          x={triggerLayout.x}
          y={triggerLayout.y}
          width={4}
          height={TRIGGER_HEIGHT}
          rx={4}
          fill="hsl(var(--kind-trigger))"
          aria-hidden="true"
        />
        <text
          x={triggerLayout.x + TRIGGER_WIDTH / 2}
          y={triggerLayout.y + TRIGGER_HEIGHT / 2 - 6}
          textAnchor="middle"
          fill="hsl(var(--foreground))"
          fontSize={12}
          fontFamily="ui-monospace, monospace"
          fontWeight="600"
        >
          trigger
        </text>
        <text
          x={triggerLayout.x + TRIGGER_WIDTH / 2}
          y={triggerLayout.y + TRIGGER_HEIGHT / 2 + 8}
          textAnchor="middle"
          fill="hsl(var(--kind-trigger))"
          fontSize={9}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontWeight="600"
          letterSpacing="0.06em"
        >
          TRIGGER
        </text>
        {/* Trigger output port */}
        <circle
          cx={triggerLayout.outputPort.x}
          cy={triggerLayout.outputPort.y}
          r={5}
          fill="hsl(var(--accent-flow))"
        />

        {/* Wires — rendered below cards */}
        <WireLayer
          chain={chain}
          catalog={catalog}
          validation={validation}
          selectedStepId={selectedStepId}
          runStatuses={run.stepStatuses}
        />

        {/* Step cards */}
        {chain.steps.map((step) => {
          const layout = layoutMap.get(step.stepId);
          if (!layout) return null;
          const isSelected = selectedStepId === step.stepId;
          const catalogEntry = catalog.find((c) => c.id === step.nodeId);
          const inputFields = catalogEntry?.inputFields ?? [];
          const outputPortY = layout.y + layout.height / 2;

          return (
            <g key={step.stepId}>
              {/* Input ports: one for each input field row */}
              {inputFields.map((field, fieldIdx) => {
                const portY = layout.y + CARD_HEADER_HEIGHT + fieldIdx * FIELD_ROW_HEIGHT + FIELD_ROW_HEIGHT / 2;
                return (
                  <circle
                    key={`${step.stepId}-input-port-${field.name}`}
                    cx={layout.x}
                    cy={portY}
                    r={4.5}
                    fill={isSelected ? "hsl(var(--accent-flow))" : "hsl(var(--muted-foreground))"}
                    stroke="hsl(var(--border))"
                    strokeWidth={1}
                    className="transition-all cursor-pointer hover:scale-125"
                    // SVG transforms pivot on the view-box origin by default, so a
                    // bare scale() flings the circle away from the cursor and causes
                    // a hover/un-hover jitter loop. Pivot on the circle's own center.
                    style={{ transformBox: "fill-box", transformOrigin: "center" }}
                    onClick={() =>
                      dispatch({
                        type: "SET_SELECTION",
                        stepId: selectedStepId === step.stepId ? null : step.stepId,
                      })
                    }
                  />
                );
              })}

              {/* Output port: single center-right */}
              <circle
                cx={layout.x + CARD_WIDTH}
                cy={outputPortY}
                r={4.5}
                fill={isSelected ? "hsl(var(--accent-flow))" : "hsl(var(--muted-foreground))"}
                stroke="hsl(var(--border))"
                strokeWidth={1}
                className="transition-all cursor-pointer hover:scale-125"
                // Pivot the hover-scale on the circle's own center (see input port).
                style={{ transformBox: "fill-box", transformOrigin: "center" }}
                onClick={() =>
                  dispatch({
                    type: "SET_SELECTION",
                    stepId: selectedStepId === step.stepId ? null : step.stepId,
                  })
                }
              />

              <NodeCard
                step={step}
                catalogEntry={catalogEntry}
                x={layout.x}
                y={layout.y}
                selected={isSelected}
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

              {isSelected && (() => {
                const idx = chain.steps.findIndex((s) => s.stepId === step.stepId);
                return (
                  <foreignObject
                    x={layout.x}
                    y={layout.y + layout.height + 4}
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
            </g>
          );
        })}
      </g>
    </svg>

    {/* Zoom controls — bottom-right, overlaying the canvas */}
    <div
      className="absolute bottom-4 right-4 flex items-center gap-1 bg-background/80 backdrop-blur border rounded-md p-1 shadow-sm"
      style={{ zIndex: 10 }}
    >
      <button
        onClick={onZoomOut}
        className="w-7 h-7 flex items-center justify-center text-sm font-medium rounded hover:bg-muted transition-colors border border-transparent"
        aria-label="Zoom out"
        title="Zoom out (−)"
      >
        −
      </button>
      <button
        onClick={onZoomFit}
        className="px-2 h-7 flex items-center justify-center text-xs font-medium rounded hover:bg-muted transition-colors border border-transparent"
        aria-label="Fit to screen"
        title="Fit to screen (0)"
      >
        fit
      </button>
      <button
        onClick={onZoomIn}
        className="w-7 h-7 flex items-center justify-center text-sm font-medium rounded hover:bg-muted transition-colors border border-transparent"
        aria-label="Zoom in"
        title="Zoom in (+)"
      >
        +
      </button>
    </div>
  </div>
);
}
