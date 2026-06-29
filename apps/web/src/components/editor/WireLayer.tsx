import type { Chain, Ref, NodeCatalogEntry } from "@tool-chain/core";
import { computeLayout, CARD_HEADER_HEIGHT, FIELD_ROW_HEIGHT } from "./layout";
import type { ValidationState, StepStatus } from "@/types/editor";

interface Props {
  chain: Chain;
  catalog: NodeCatalogEntry[];
  validation: ValidationState;
  selectedStepId: string | null;
  runStatuses: Record<string, StepStatus>;
}

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const cx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
}

export function WireLayer({ chain, catalog, validation, selectedStepId, runStatuses }: Props) {
  const layouts = computeLayout(chain.steps, catalog);
  const layoutMap = new Map(layouts.map((l) => [l.id, l]));

  type Wire = {
    d: string;
    invalid: boolean;
    targetStepId: string;
    sourceId: string;
  };

  const wires: Wire[] = [];

  for (let i = 0; i < chain.steps.length; i++) {
    const step = chain.steps[i]!;
    const targetLayout = layoutMap.get(step.stepId);
    if (!targetLayout) continue;

    const stepValidation = validation.steps.find((v) => v.stepId === step.stepId);
    const catalogEntry = catalog.find((c) => c.id === step.nodeId);
    const inputFields = catalogEntry?.inputFields ?? [];

    for (const [fieldName, ref] of Object.entries(step.inputMapping) as [string, Ref][]) {
      if ("value" in ref) continue; // literals have no wire

      const isDangling = stepValidation?.fields.some(
        (f) => f.fieldName === fieldName && f.problem === "dangling-ref",
      );

      const fromId = (ref as { from: string }).from === "trigger"
        ? "trigger"
        : (ref as { from: string }).from;

      const sourceLayout = layoutMap.get(fromId);

      // Find the index of the field in target's input fields to calculate exact Y offset
      const fieldIdx = inputFields.findIndex((f) => f.name === fieldName);
      const targetY =
        targetLayout.y +
        CARD_HEADER_HEIGHT +
        (fieldIdx >= 0 ? fieldIdx : 0) * FIELD_ROW_HEIGHT +
        FIELD_ROW_HEIGHT / 2;

      if (!sourceLayout) {
        if (isDangling) {
          wires.push({
            d: bezierPath(
              targetLayout.inputPort.x - 60,
              targetY,
              targetLayout.inputPort.x,
              targetY,
            ),
            invalid: true,
            targetStepId: step.stepId,
            sourceId: fromId,
          });
        }
        continue;
      }

      wires.push({
        d: bezierPath(
          sourceLayout.outputPort.x,
          sourceLayout.outputPort.y,
          targetLayout.inputPort.x,
          targetY,
        ),
        invalid: !!isDangling,
        targetStepId: step.stepId,
        sourceId: fromId,
      });
    }
  }

  return (
    <>
      {wires.map((wire, i) => {
        const wireKey = `${wire.sourceId}→${wire.targetStepId}:${i}`;
        if (wire.invalid) {
          return (
            <path
              key={wireKey}
              d={wire.d}
              fill="none"
              stroke="hsl(var(--wire-invalid))"
              strokeWidth={2}
              strokeDasharray="6,4"
              aria-hidden="true"
            />
          );
        }

        const targetStatus = runStatuses[wire.targetStepId];
        const isRunning = targetStatus === "running";
        const isOk = targetStatus === "ok";

        // Selection-related dimming/brightening
        const isRelatedToSelection =
          selectedStepId != null &&
          (wire.targetStepId === selectedStepId || wire.sourceId === selectedStepId);
        const hasSelection = selectedStepId != null;

        let strokeColor: string;
        let strokeOpacity: number;

        if (isRunning) {
          strokeColor = "hsl(var(--accent-run))";
          strokeOpacity = 1;
        } else if (isOk) {
          strokeColor = "hsl(var(--accent-run))";
          strokeOpacity = 0.5;
        } else if (hasSelection) {
          strokeColor = isRelatedToSelection
            ? "hsl(var(--accent-flow))"
            : "hsl(var(--wire))";
          strokeOpacity = isRelatedToSelection ? 1 : 0.3;
        } else {
          strokeColor = "hsl(var(--wire))";
          strokeOpacity = 1;
        }

        const strokeWidth = isRelatedToSelection ? 2.5 : 2;

        if (isRunning) {
          return (
            <g key={wireKey} aria-hidden="true">
              {/* Base wire */}
              <path d={wire.d} fill="none" stroke="hsl(var(--wire))" strokeWidth={2} strokeOpacity={0.3} />
              {/* Animated flowing dash */}
              <path
                d={wire.d}
                fill="none"
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeDasharray="8,8"
                style={{
                  animationName: "wire-flow",
                  animationDuration: "0.6s",
                  animationTimingFunction: "linear",
                  animationIterationCount: "infinite",
                }}
              />
            </g>
          );
        }

        return (
          <path
            key={wireKey}
            d={wire.d}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeOpacity={strokeOpacity}
            aria-hidden="true"
          />
        );
      })}
    </>
  );
}
