"use client";

interface Props {
  chainName: string;
  dirty: boolean;
  valid: boolean;
  saving: boolean;
  onSave: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
}

export function Toolbar({
  chainName,
  dirty,
  valid,
  saving,
  onSave,
  onZoomIn,
  onZoomOut,
  onZoomFit,
}: Props) {
  const canSave = dirty && valid && !saving;

  return (
    <div className="border-b bg-background px-4 py-2 flex items-center gap-3 shrink-0">
      <span className="font-semibold text-sm flex-1 truncate">
        {chainName}
        {dirty && !valid && (
          <span className="ml-2 text-xs text-destructive font-normal">
            invalid wiring
          </span>
        )}
        {dirty && valid && (
          <span className="ml-2 text-xs text-muted-foreground font-normal">
            • unsaved
          </span>
        )}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={onZoomOut}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted"
          title="Zoom out"
        >
          −
        </button>
        <button
          onClick={onZoomFit}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted"
          title="Fit to screen"
        >
          fit
        </button>
        <button
          onClick={onZoomIn}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted"
          title="Zoom in"
        >
          +
        </button>
      </div>
      <button
        onClick={onSave}
        disabled={!canSave}
        className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
