"use client";

interface StepDef {
  stepId: string;
  label: string;
}

const STEPS: StepDef[] = [
  { stepId: "s1", label: "Download File" },
  { stepId: "s2", label: "Extract Text" },
  { stepId: "s3", label: "Parse Fields" },
];

type StepState = "pending" | "running" | "ok" | "failed";
type RunStatus = "idle" | "running" | "done" | "error";

interface Props {
  status: RunStatus;
  stepLog: string[];
  elapsedMs: number;
  errorMsg: string | null;
  /** Total LLM tokens for the run; null/0 hides the token readout. */
  totalTokens?: number | null;
}

function parseStepStates(stepLog: string[]): Record<string, StepState> {
  const states: Record<string, StepState> = {};
  for (const entry of stepLog) {
    // format: "Step s1: running" | "Step s1: ok" | "Step s1: failed"
    const match = /^Step (\S+): (\S+)$/.exec(entry);
    if (!match) continue;
    const [, id, st] = match;
    if (st === "running") states[id!] = "running";
    else if (st === "ok") states[id!] = "ok";
    else if (st === "failed") states[id!] = "failed";
  }
  return states;
}

function formatElapsed(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = ((ms % 60_000) / 1000).toFixed(0).padStart(2, "0");
  return `${m}m ${s}s`;
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "ok") {
    return (
      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[hsl(var(--accent-run))] text-white text-xs font-bold shrink-0">
        ✓
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-destructive text-destructive-foreground text-xs font-bold shrink-0">
        ✕
      </span>
    );
  }
  if (state === "running") {
    return (
      <span className="flex items-center justify-center w-6 h-6 shrink-0">
        <span
          className="w-5 h-5 rounded-full border-2 border-[hsl(var(--accent-flow))] border-t-transparent animate-spin"
          aria-hidden
        />
      </span>
    );
  }
  // pending
  return (
    <span className="flex items-center justify-center w-6 h-6 rounded-full border-2 border-border shrink-0" />
  );
}

function statusChip(status: RunStatus) {
  if (status === "running")
    return <span className="text-xs font-medium text-[hsl(var(--accent-flow))]">Running…</span>;
  if (status === "done")
    return <span className="text-xs font-medium text-[hsl(var(--accent-run))]">Done</span>;
  if (status === "error")
    return <span className="text-xs font-medium text-destructive">Error</span>;
  return null;
}

export function RunStatusCard({ status, stepLog, elapsedMs, errorMsg, totalTokens }: Props) {
  if (status === "idle") return null;

  const stepStates = parseStepStates(stepLog);

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-5 mb-6 space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {statusChip(status)}
        </div>
        <div className="flex items-center gap-3 text-sm font-mono tabular-nums text-muted-foreground">
          {totalTokens != null && totalTokens > 0 && (
            <span title="Total LLM tokens used by this run">
              {/* ≈ {totalTokens.toLocaleString()} tokens */}
            </span>
          )}
          <span>{formatElapsed(elapsedMs)}</span>
        </div>
      </div>

      {/* Stepper */}
      <ol className="flex items-start gap-0">
        {STEPS.map((step, idx) => {
          const state: StepState = stepStates[step.stepId] ?? "pending";
          const isLast = idx === STEPS.length - 1;
          return (
            <li key={step.stepId} className="flex items-start flex-1">
              <div className="flex flex-col items-center w-full">
                {/* icon + connector */}
                <div className="flex items-center w-full">
                  <StepIcon state={state} />
                  {!isLast && (
                    <div
                      className={`flex-1 h-0.5 mx-1 rounded transition-colors duration-300 ${
                        state === "ok"
                          ? "bg-[hsl(var(--accent-run))]"
                          : "bg-border"
                      }`}
                    />
                  )}
                </div>
                {/* label */}
                <span
                  className={`mt-1.5 text-xs text-center leading-tight pr-2 ${
                    state === "running"
                      ? "text-[hsl(var(--accent-flow))] font-medium"
                      : state === "ok"
                      ? "text-foreground"
                      : state === "failed"
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Error message */}
      {status === "error" && errorMsg && (
        <p className="text-xs text-destructive font-mono border-t border-destructive/20 pt-3">
          {errorMsg}
        </p>
      )}
    </div>
  );
}
