"use client";

import type { Chain, Step, NodeCatalogEntry, Ref } from "@tool-chain/core";
import type { EditorAction } from "@/hooks/useChainEditor";
import type { ValidationState } from "@/types/editor";
import { RefEditor } from "./RefEditor";

interface Props {
  step: Step;
  stepIndex: number;
  chain: Chain;
  catalog: NodeCatalogEntry[];
  validation: ValidationState;
  dispatch: React.Dispatch<EditorAction>;
}

function kindColor(kind: string | undefined): string {
  if (kind === "skill") return "hsl(var(--kind-skill))";
  if (kind === "tool") return "hsl(var(--kind-tool))";
  return "hsl(var(--kind-trigger))";
}

function kindLabel(kind: string | undefined): string {
  if (kind === "skill") return "SKILL";
  if (kind === "tool") return "TOOL";
  return "NODE";
}

export function NodeInspector({
  step,
  stepIndex,
  chain,
  catalog,
  validation,
  dispatch,
}: Props) {
  const catalogEntry = catalog.find((c) => c.id === step.nodeId);
  const stepValidation = validation.steps.find((v) => v.stepId === step.stepId);
  const kind = catalogEntry?.kind;

  const inputFields =
    catalogEntry?.inputFields ?? Object.keys(step.inputMapping).map((name) => ({
      name,
      type: "unknown",
      required: true,
    }));

  function handleRefChange(fieldName: string, ref: Ref) {
    dispatch({ type: "SET_REF", stepId: step.stepId, fieldName, ref });
  }

  function handleClose() {
    dispatch({ type: "SET_SELECTION", stepId: null });
  }

  return (
    <>
      {/* Scrim — dims the canvas slightly when drawer is open */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{ background: "hsl(var(--foreground) / 0.05)", zIndex: 10 }}
      />

      {/* Drawer */}
      <div
        role="complementary"
        aria-label={`Inspector for ${step.nodeId}`}
        className="absolute right-0 top-0 bottom-0 bg-background border-l overflow-y-auto"
        style={{
          width: 360,
          zIndex: 20,
          boxShadow: "-4px 0 24px rgb(0 0 0 / 0.08)",
          animation: "slideInRight 0.2s cubic-bezier(0.2,0,0,1) both",
        }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between p-4 border-b sticky top-0 bg-background"
          style={{ gap: 8 }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="flex items-center gap-2">
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: kindColor(kind),
                  flexShrink: 0,
                }}
                aria-hidden="true"
              />
              <span className="font-mono font-semibold text-sm truncate">{step.nodeId}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className="text-[10px] font-semibold tracking-wider"
                style={{ color: kindColor(kind) }}
              >
                {kindLabel(kind)}
              </span>
              {catalogEntry?.description && (
                <span className="text-xs text-muted-foreground truncate">
                  · {catalogEntry.description}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={handleClose}
            aria-label="Close inspector"
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Input wiring section */}
        <div className="p-4 space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Input Mapping
          </p>
          {inputFields.map((field) => {
            const hasProblem = !!stepValidation?.fields.some(
              (f) => f.fieldName === field.name,
            );
            return (
              <RefEditor
                key={field.name}
                fieldName={field.name}
                fieldType={field.type}
                ref={step.inputMapping[field.name]}
                stepIndex={stepIndex}
                allSteps={chain.steps}
                catalog={catalog}
                hasProblem={hasProblem}
                onChange={(ref) => handleRefChange(field.name, ref)}
              />
            );
          })}
          {inputFields.length === 0 && (
            <p className="text-xs text-muted-foreground">No input fields.</p>
          )}
        </div>

        {/* Output fields section */}
        {catalogEntry && catalogEntry.outputFields.length > 0 && (
          <div className="px-4 pb-4 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Output Fields
            </p>
            {catalogEntry.outputFields.map((f) => (
              <div
                key={f.name}
                className="flex items-center justify-between text-xs"
                style={{ gap: 8 }}
              >
                <span className="font-mono text-foreground truncate">{f.name}</span>
                <span
                  className="shrink-0 px-1.5 py-0.5 rounded text-[10px]"
                  style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}
                >
                  {f.type}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

    </>
  );
}
