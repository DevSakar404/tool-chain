import type { Chain, Ref } from "@tool-chain/core";
import { computeLayout } from "./layout";
import type { ValidationState } from "@/types/editor";

interface Props {
  chain: Chain;
  validation: ValidationState;
}

function bezierPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const cx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
}

export function WireLayer({ chain, validation }: Props) {
  const layouts = computeLayout(chain.steps.map((s) => s.stepId));
  const layoutMap = new Map(layouts.map((l) => [l.id, l]));

  const wires: Array<{ d: string; invalid: boolean }> = [];

  for (let i = 0; i < chain.steps.length; i++) {
    const step = chain.steps[i]!;
    const targetLayout = layoutMap.get(step.stepId);
    if (!targetLayout) continue;

    const stepValidation = validation.steps.find((v) => v.stepId === step.stepId);

    for (const [fieldName, ref] of Object.entries(step.inputMapping) as [string, Ref][]) {
      const isDangling = stepValidation?.fields.some(
        (f) => f.fieldName === fieldName && f.problem === "dangling-ref",
      );

      let sourceLayout = undefined;
      if ("from" in ref) {
        sourceLayout = layoutMap.get(ref.from === "trigger" ? "trigger" : ref.from);
      }

      if (!sourceLayout) {
        // Only draw a stub if this is a step/trigger ref (not a literal) and it's dangling
        if ("from" in ref && isDangling) {
          const stubEndX = targetLayout.inputPort.x - 60;
          const stubEndY = targetLayout.inputPort.y;
          wires.push({
            d: bezierPath(
              stubEndX,
              stubEndY,
              targetLayout.inputPort.x,
              targetLayout.inputPort.y,
            ),
            invalid: true,
          });
        }
        continue;
      }

      wires.push({
        d: bezierPath(
          sourceLayout.outputPort.x,
          sourceLayout.outputPort.y,
          targetLayout.inputPort.x,
          targetLayout.inputPort.y,
        ),
        invalid: !!isDangling,
      });
    }
  }

  return (
    <>
      {wires.map((wire, i) => (
        <path
          key={i}
          d={wire.d}
          fill="none"
          stroke={wire.invalid ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))"}
          strokeWidth={2}
          strokeDasharray={wire.invalid ? "6,4" : undefined}
        />
      ))}
    </>
  );
}
