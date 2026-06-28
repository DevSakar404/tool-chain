"use client";

import { useRef, useCallback } from "react";
import type { Chain, NodeCatalogEntry } from "@tool-chain/core";
import type { EditorAction } from "@/hooks/useChainEditor";
import type { ValidationState, RunState } from "@/types/editor";
import { NodeCard } from "./NodeCard";
import { WireLayer } from "./WireLayer";
import { computeLayout, TRIGGER_WIDTH, TRIGGER_HEIGHT, CARD_HEIGHT, CARD_WIDTH } from "./layout";

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

export function ChainCanvas({
  chain,
  catalog,
  selectedStepId,
  validation,
  run,
  dispatch,
  viewport,
  setViewport,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
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
                onDelete={() => dispatch({ type: "REMOVE_STEP", stepId: step.stepId })}
              />
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
            </g>
          );
        })}
      </g>
    </svg>
  );
}
