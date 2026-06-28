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
}

const STATUS_COLORS: Record<StepStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-blue-500",
  ok: "text-green-500",
  error: "text-destructive",
};

export function NodeCard({
  step,
  catalogEntry,
  x,
  y,
  selected,
  status,
  validation,
  onClick,
}: Props) {
  const hasError = validation.steps.some((v) => v.stepId === step.stepId);
  const borderColor = selected
    ? "border-primary"
    : hasError
      ? "border-destructive"
      : "border-border";
  const statusColor = status ? STATUS_COLORS[status] : "";

  return (
    <foreignObject x={x} y={y} width={CARD_WIDTH} height={CARD_HEIGHT}>
      <div
        className={`w-full h-full rounded-lg border-2 bg-card text-card-foreground shadow-sm cursor-pointer select-none p-3 flex flex-col justify-between ${borderColor}`}
        onClick={onClick}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono truncate">{step.nodeId}</span>
          <span
            className={`text-xs rounded-full px-1.5 py-0.5 bg-muted ${catalogEntry?.kind === "skill" ? "text-purple-600" : "text-blue-600"}`}
          >
            {catalogEntry?.kind ?? "?"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground truncate">
            {catalogEntry?.description ?? step.nodeId}
          </span>
          {status && <span className={`text-xs font-medium ${statusColor}`}>{status}</span>}
        </div>
      </div>
    </foreignObject>
  );
}
