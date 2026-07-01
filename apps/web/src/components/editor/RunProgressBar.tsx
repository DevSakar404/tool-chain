"use client";

import { useEffect, useState } from "react";
import type { Step } from "@tool-chain/core";
import type { RunState, StepStatus } from "@/types/editor";

interface Props {
  steps: Step[];
  run: RunState;
  /** Historical average duration (ms) per stepId, from past runs. */
  stepAverages: Record<string, number>;
}

// "drive.download_file" -> "Download File"
function stepLabel(nodeId: string): string {
  const last = nodeId.split(".").pop() ?? nodeId;
  return last
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// No history for a step yet — split the average evenly so paced progress
// still has something to go on for a chain that's never run before.
const DEFAULT_STEP_MS = 2000;

// Cumulative expected start time for each step, based on historical averages
// (or the default when a step has no history yet). Used to pace the "running"
// indicator smoothly instead of it sitting idle until the real SSE event.
export function expectedStartTimes(steps: Step[], stepAverages: Record<string, number>): number[] {
  const starts: number[] = [];
  let cumulative = 0;
  for (const step of steps) {
    starts.push(cumulative);
    cumulative += stepAverages[step.stepId] ?? DEFAULT_STEP_MS;
  }
  return starts;
}

// Real status always wins. Absent real status, pace a "running" look once
// elapsed time crosses this step's expected start — never fabricate "ok".
export function pacedStatus(
  real: StepStatus | undefined,
  expectedStart: number,
  elapsedMs: number,
  active: boolean,
): StepStatus | undefined {
  if (real) return real;
  if (active && elapsedMs >= expectedStart) return "running";
  return real;
}

function dotStyle(status: StepStatus | undefined): React.CSSProperties {
  if (status === "ok") return { background: "hsl(var(--accent-run))", color: "white" };
  if (status === "error") return { background: "hsl(var(--destructive))", color: "white" };
  if (status === "running") {
    return {
      background: "transparent",
      border: "2px solid hsl(var(--accent-flow))",
      color: "hsl(var(--accent-flow))",
    };
  }
  return {
    background: "transparent",
    border: "2px dashed hsl(var(--muted-foreground) / 0.4)",
    color: "hsl(var(--muted-foreground))",
  };
}

function dotContent(status: StepStatus | undefined): string {
  if (status === "ok") return "✓";
  if (status === "error") return "✕";
  return "";
}

export function RunProgressBar({ steps, run, stepAverages }: Props) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!run.active) return;
    setElapsedMs(0);
    const start = performance.now();
    const id = setInterval(() => setElapsedMs(performance.now() - start), 100);
    return () => clearInterval(id);
  }, [run.active]);

  const headerLabel = run.active ? "Running…" : run.error ? "Failed" : "Done";
  const headerColor = run.error ? "hsl(var(--destructive))" : "hsl(var(--accent-run))";
  const starts = expectedStartTimes(steps, stepAverages);

  return (
    <div className="border-t bg-background p-3 space-y-3 shrink-0">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: headerColor }}>
          {headerLabel}
        </span>
        <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
          {run.totalTokens != null && run.totalTokens > 0 && (
            <span>≈ {run.totalTokens.toLocaleString()} tokens</span>
          )}
          <span>{(elapsedMs / 1000).toFixed(1)}s</span>
        </div>
      </div>

      <div className="flex items-center">
        {steps.map((step, i) => {
          const status = pacedStatus(run.stepStatuses[step.stepId], starts[i]!, elapsedMs, run.active);
          return (
            <div key={step.stepId} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0"
                  style={dotStyle(status)}
                >
                  {dotContent(status)}
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {stepLabel(step.nodeId)}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  className="flex-1 h-px mx-1"
                  style={{
                    background: status === "ok" ? "hsl(var(--accent-run))" : "hsl(var(--border))",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {run.error && <p className="text-sm text-destructive">{run.error}</p>}
    </div>
  );
}
