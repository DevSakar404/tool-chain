"use client";

import type { Chain, NodeCatalogEntry } from "@tool-chain/core";
import type { EditorAction } from "@/hooks/useChainEditor";

interface Props {
  chain: Chain;
  catalog: NodeCatalogEntry[];
  trigger: Record<string, unknown>;
  dispatch: React.Dispatch<EditorAction>;
  onRun: () => void;
  canRun: boolean;
  running: boolean;
}

interface TriggerField {
  path: string;
  type: string; // "string" | "number" | "boolean" | "object" | "unknown"
}

// Trigger fields are whatever paths the chain's steps actually reference —
// there's no declared trigger schema (v1 trigger is "open"). Type is inferred
// from the consuming step's declared input field, defaulting to string.
function deriveTriggerFields(chain: Chain, catalog: NodeCatalogEntry[]): TriggerField[] {
  const fields = new Map<string, TriggerField>();
  for (const step of chain.steps) {
    const catalogEntry = catalog.find((c) => c.id === step.nodeId);
    for (const [fieldName, ref] of Object.entries(step.inputMapping)) {
      if (!("from" in ref) || ref.from !== "trigger") continue;
      const path = ref.path;
      if (fields.has(path)) continue;
      const type = catalogEntry?.inputFields.find((f) => f.name === fieldName)?.type ?? "string";
      fields.set(path, { path, type });
    }
  }
  return [...fields.values()];
}

function coerce(type: string, raw: string): unknown {
  if (type === "number") return raw === "" ? undefined : Number(raw);
  if (type === "boolean") return raw === "true";
  return raw;
}

function toDisplayValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

export function TriggerPanel({ chain, catalog, trigger, dispatch, onRun, canRun, running }: Props) {
  const fields = deriveTriggerFields(chain, catalog);

  function handleFieldChange(path: string, type: string, raw: string) {
    dispatch({ type: "SET_TRIGGER", payload: { ...trigger, [path]: coerce(type, raw) } });
  }

  return (
    <div className="border-t bg-background p-3 space-y-2 shrink-0">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Trigger Payload
        </p>
        <button
          onClick={onRun}
          disabled={!canRun}
          aria-label={running ? "Running chain" : "Run chain"}
          className="text-xs px-3 py-1.5 rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-white"
          style={{
            background: canRun || running ? "hsl(var(--accent-run))" : "hsl(var(--accent-run) / 0.5)",
          }}
        >
          {running ? "Running…" : "▶ Run"}
        </button>
      </div>
      {fields.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No trigger fields — no step reads from the trigger.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {fields.map(({ path, type }) => (
            <label key={path} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {path} <span className="text-[10px]">({type})</span>
              </span>
              <input
                className="text-xs font-mono rounded border border-border bg-background px-2 py-1"
                type={type === "number" ? "number" : "text"}
                value={toDisplayValue(trigger[path])}
                onChange={(e) => handleFieldChange(path, type, e.target.value)}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
