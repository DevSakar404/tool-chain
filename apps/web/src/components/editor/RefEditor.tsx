"use client";

import type { Ref, Step } from "@tool-chain/core";
import type { NodeCatalogEntry } from "@tool-chain/core";

type RefSource = "trigger" | "step" | "literal";

function refSource(ref: Ref | undefined): RefSource {
  if (!ref) return "trigger";
  if ("value" in ref) return "literal";
  if ("from" in ref && ref.from === "trigger") return "trigger";
  return "step";
}

interface Props {
  fieldName: string;
  fieldType?: string;
  ref: Ref | undefined;
  stepIndex: number;
  allSteps: Step[];
  catalog: NodeCatalogEntry[];
  hasProblem: boolean;
  onChange: (ref: Ref) => void;
}

export function RefEditor({
  fieldName,
  fieldType,
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
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-mono font-medium truncate">{fieldName}</span>
        <div className="flex items-center gap-1 shrink-0">
          {fieldType && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}
            >
              {fieldType}
            </span>
          )}
          {hasProblem && (
            <span className="text-[10px] text-destructive font-medium">needs wiring</span>
          )}
        </div>
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
