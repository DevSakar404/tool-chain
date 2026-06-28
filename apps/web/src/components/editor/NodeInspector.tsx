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

  const inputFields =
    catalogEntry?.inputFields ?? Object.keys(step.inputMapping).map((name) => ({
      name,
      type: "unknown",
      required: true,
    }));

  function handleRefChange(fieldName: string, ref: Ref) {
    dispatch({ type: "SET_REF", stepId: step.stepId, fieldName, ref });
  }

  return (
    <div className="w-80 border-l bg-background overflow-y-auto p-4 space-y-4 shrink-0">
      <div>
        <h3 className="font-semibold text-sm">{step.nodeId}</h3>
        <p className="text-xs text-muted-foreground">{catalogEntry?.description}</p>
      </div>
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Input Wiring
        </p>
        {inputFields.map((field) => {
          const hasProblem = !!stepValidation?.fields.some(
            (f) => f.fieldName === field.name,
          );
          return (
            <RefEditor
              key={field.name}
              fieldName={field.name}
              ref={step.inputMapping[field.name]}
              stepIndex={stepIndex}
              allSteps={chain.steps}
              catalog={catalog}
              hasProblem={hasProblem}
              onChange={(ref) => handleRefChange(field.name, ref)}
            />
          );
        })}
      </div>
      {catalogEntry && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Output Fields
          </p>
          {catalogEntry.outputFields.map((f) => (
            <div
              key={f.name}
              className="flex items-center justify-between text-xs text-muted-foreground"
            >
              <span className="font-mono">{f.name}</span>
              <span>{f.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
