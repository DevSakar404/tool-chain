"use client";

import type { Step, NodeCatalogEntry, Ref } from "@tool-chain/core";
import type { StepStatus, ValidationState } from "@/types/editor";
import { CARD_WIDTH, CARD_HEADER_HEIGHT, FIELD_ROW_HEIGHT, getCardHeight } from "./layout";

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

function renderSourceChip(ref: Ref | undefined, isRequired: boolean) {
  if (!ref) {
    if (isRequired) {
      return (
        <span
          className="text-[9px] px-1.5 py-0.5 rounded font-medium border border-dashed shrink-0"
          style={{
            borderColor: "hsl(var(--warning))",
            color: "hsl(var(--warning))",
            background: "transparent",
          }}
        >
          needs input
        </span>
      );
    }
    return null;
  }

  if ("value" in ref) {
    const valStr = String(ref.value);
    const truncated = valStr.length > 8 ? valStr.slice(0, 6) + "…" : valStr;
    return (
      <span
        className="text-[9px] px-1.5 py-0.5 rounded font-mono truncate shrink-0"
        style={{
          background: "hsl(var(--muted))",
          color: "hsl(var(--muted-foreground))",
        }}
        title={valStr}
      >
        = &quot;{truncated}&quot;
      </span>
    );
  }

  if ("from" in ref) {
    if (ref.from === "trigger") {
      return (
        <span
          className="text-[9px] px-1.5 py-0.5 rounded font-mono truncate shrink-0"
          style={{
            background: "hsl(var(--kind-trigger) / 0.15)",
            color: "hsl(var(--kind-trigger))",
          }}
        >
          ◀ trigger.{ref.path}
        </span>
      );
    }
    return (
      <span
        className="text-[9px] px-1.5 py-0.5 rounded font-mono truncate shrink-0"
        style={{
          background: "hsl(var(--accent-flow) / 0.15)",
          color: "hsl(var(--accent-flow))",
        }}
      >
        ◀ {ref.from}.{ref.path}
      </span>
    );
  }

  return null;
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

  const inputFields = catalogEntry?.inputFields ?? [];
  const height = getCardHeight(inputFields.length);

  const ariaLabel = `${step.nodeId}, ${kindLabel(kind)}, ${inputFields.length} inputs${status ? `, status ${status}` : ""}`;

  return (
    <foreignObject x={x} y={y} width={CARD_WIDTH} height={height}>
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
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {/* Header row */}
          <div
            style={{
              height: CARD_HEADER_HEIGHT,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 10px 0 8px",
              borderBottom: "1px solid hsl(var(--border))",
              gap: 4,
            }}
          >
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

          {/* Input field rows */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            {inputFields.map((field, idx) => (
              <div
                key={field.name}
                style={{
                  height: FIELD_ROW_HEIGHT,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0 10px 0 8px",
                  gap: 8,
                  borderBottom: idx === inputFields.length - 1 ? "none" : "1px solid hsl(var(--border) / 0.4)",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "ui-monospace, monospace",
                    color: "hsl(var(--muted-foreground))",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {field.name}
                </span>
                {renderSourceChip(step.inputMapping[field.name], field.required)}
              </div>
            ))}
            {inputFields.length === 0 && (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 8px",
                  fontSize: 10,
                  color: "hsl(var(--muted-foreground))",
                  fontStyle: "italic",
                }}
              >
                {catalogEntry?.description ?? "No inputs required"}
              </div>
            )}
          </div>
        </div>
      </div>
    </foreignObject>
  );
}
