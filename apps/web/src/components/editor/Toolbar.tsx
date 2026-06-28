"use client";

import Link from "next/link";

interface Props {
  chainName: string;
  dirty: boolean;
  valid: boolean;
  saving: boolean;
  running: boolean;
  onSave: () => void;
  onRun: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
}

export function Toolbar({
  chainName,
  dirty,
  valid,
  saving,
  running,
  onSave,
  onRun,
  onZoomIn,
  onZoomOut,
  onZoomFit,
}: Props) {
  const canSave = dirty && valid && !saving && !running;
  const canRun = !dirty && valid && !running && !saving;

  const saveTitle = !valid
    ? "Fix invalid wiring before saving"
    : !dirty
      ? "No unsaved changes"
      : undefined;

  return (
    <div
      className="border-b bg-background px-4 flex items-center gap-3 shrink-0"
      style={{ height: 56 }}
    >
      {/* Back chevron */}
      <Link
        href="/"
        aria-label="Back to chains"
        className="flex items-center text-muted-foreground hover:text-foreground transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>

      {/* Chain name + dirty pill */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="font-semibold text-sm truncate">{chainName}</span>
        {dirty && valid && (
          <span
            className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{ background: "hsl(var(--warning) / 0.15)", color: "hsl(var(--warning))" }}
          >
            <span aria-hidden="true">•</span>
            unsaved
          </span>
        )}
        {dirty && !valid && (
          <span
            className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{ background: "hsl(var(--destructive) / 0.12)", color: "hsl(var(--destructive))" }}
          >
            <span aria-hidden="true">⚠</span>
            invalid wiring
          </span>
        )}
      </div>

      {/* Zoom controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={onZoomOut}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
          aria-label="Zoom out"
          title="Zoom out (−)"
        >
          −
        </button>
        <button
          onClick={onZoomFit}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
          aria-label="Fit to screen"
          title="Fit to screen (0)"
        >
          fit
        </button>
        <button
          onClick={onZoomIn}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
          aria-label="Zoom in"
          title="Zoom in (+)"
        >
          +
        </button>
      </div>

      {/* Save */}
      <button
        onClick={onSave}
        disabled={!canSave}
        title={saveTitle}
        aria-label="Save chain"
        className="text-xs px-3 py-1.5 rounded border border-border font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted transition-colors"
      >
        {saving ? "Saving…" : "Save"}
      </button>

      {/* Run — always green */}
      <button
        onClick={onRun}
        disabled={!canRun}
        title={dirty ? "Save changes before running" : !valid ? "Fix wiring before running" : undefined}
        aria-label={running ? "Running chain" : "Run chain"}
        className="text-xs px-3 py-1.5 rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-white"
        style={{
          background: canRun || running ? "hsl(var(--accent-run))" : "hsl(var(--accent-run) / 0.5)",
        }}
      >
        {running ? "Running…" : "▶ Run"}
      </button>
    </div>
  );
}
