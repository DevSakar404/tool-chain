"use client";

import { useState } from "react";
import type { EditorAction } from "@/hooks/useChainEditor";

interface Props {
  trigger: Record<string, unknown>;
  dispatch: React.Dispatch<EditorAction>;
}

export function TriggerPanel({ trigger, dispatch }: Props) {
  const [raw, setRaw] = useState(() => JSON.stringify(trigger, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  function handleChange(value: string) {
    setRaw(value);
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      setParseError(null);
      dispatch({ type: "SET_TRIGGER", payload: parsed });
    } catch {
      setParseError("Invalid JSON");
    }
  }

  return (
    <div className="border-t bg-background p-3 space-y-2 shrink-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Trigger Payload
      </p>
      <textarea
        className={`w-full h-24 text-xs font-mono rounded border bg-background px-2 py-1 resize-none ${
          parseError ? "border-destructive" : "border-border"
        }`}
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
      />
      {parseError && (
        <p className="text-xs text-destructive">{parseError}</p>
      )}
    </div>
  );
}
