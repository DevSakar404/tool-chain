"use client";

import type { Step, NodeCatalogEntry } from "@tool-chain/core";
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

function kindRailColor(kind: string | undefined): string {
  if (kind === "skill") return "hsl(var(--kind-skill))";
  if (kind === "tool") return "hsl(var(--kind-tool))";
  return "hsl(var(--kind-trigger))";
}

function kindLabel(kind: string | undefined): string {
  if (kind === "skill") return "SKILL";
  if (kind === "tool") return "TOOL";
  return "NODE";
}

function statusRingStyle(status: StepStatus | undefined, selected: boolean): React.CSSProperties {
  if (status === "running") {
    return {
      outline: `2px solid hsl(var(--accent-flow))`,
      outlineOffset: "2px",
      animationName: "ring-pulse",
      animationDuration: "1.4s",
      animationTimingFunction: "ease-in-out",
      animationIterationCount: "infinite",
    };
  }
  if (status === "ok") {
    return { outline: `2px solid hsl(var(--accent-run))`, outlineOffset: "2px" };
  }
  if (status === "error") {
    return { outline: `2px solid hsl(var(--destructive))`, outlineOffset: "2px" };
  }
  if (status === "pending") {
    return { outline: `2px dashed hsl(var(--kind-trigger))`, outlineOffset: "2px" };
  }
  if (selected) {
    return {
      outline: `2px solid hsl(var(--accent-flow))`,
      outlineOffset: "2px",
      boxShadow: "0 8px 24px rgb(0 0 0 / 0.10)",
    };
  }
  return {};
}

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
  const kind = catalogEntry?.kind;
  const railColor = kindRailColor(kind);

  const baseBoxShadow = "0 1px 2px rgb(0 0 0 / 0.06), 0 4px 12px rgb(0 0 0 / 0.04)";
  const ringStyle = statusRingStyle(status, selected);

  const borderColor = hasError && !status ? "hsl(var(--destructive))" : "hsl(var(--border))";

  const inputCount = catalogEntry?.inputFields.length ?? Object.keys(step.inputMapping).length;
  const ariaLabel = `${step.nodeId}, ${kindLabel(kind)}, ${inputCount} inputs${status ? `, status ${status}` : ""}`;

  return (
    <foreignObject x={x} y={y} width={CARD_WIDTH} height={CARD_HEIGHT}>
      <div
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-pressed={selected}
        style={{
          ...ringStyle,
          boxShadow: ringStyle.boxShadow ?? baseBoxShadow,
          border: `1px solid ${borderColor}`,
          display: "flex",
          width: "100%",
          height: "100%",
          borderRadius: "var(--radius)",
          background: "hsl(var(--card))",
          color: "hsl(var(--card-foreground))",
          cursor: "pointer",
          userSelect: "none",
          overflow: "hidden",
          position: "relative",
        }}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
          if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onDelete(); }
        }}
      >
        {/* Kind rail — 4px left bar */}
        <div
          aria-hidden="true"
          style={{
            width: 4,
            flexShrink: 0,
            background: railColor,
            borderRadius: "var(--radius) 0 0 var(--radius)",
          }}
        />

        {/* Card body */}
        <div style={{ flex: 1, padding: "10px 10px 10px 8px", display: "flex", flexDirection: "column", justifyContent: "space-between", minWidth: 0 }}>
          {/* Header row */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 4 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 11,
                  fontFamily: "ui-monospace, monospace",
                  fontWeight: 600,
                  color: "hsl(var(--card-foreground))",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {step.nodeId}
              </div>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  color: railColor,
                  marginTop: 1,
                }}
              >
                {kindLabel(kind)}
              </div>
            </div>
            {selected && (
              <button
                aria-label="Remove step"
                style={{
                  fontSize: 11,
                  padding: "1px 5px",
                  borderRadius: 4,
                  border: "none",
                  background: "transparent",
                  color: "hsl(var(--destructive))",
                  cursor: "pointer",
                  flexShrink: 0,
                  lineHeight: 1,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Description */}
          <div
            style={{
              fontSize: 10,
              color: "hsl(var(--muted-foreground))",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {catalogEntry?.description ?? step.nodeId}
          </div>
        </div>
      </div>
    </foreignObject>
  );
}
