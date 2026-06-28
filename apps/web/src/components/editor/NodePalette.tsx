"use client";

import { useState } from "react";
import type { NodeCatalogEntry } from "@tool-chain/core";
import type { EditorAction } from "@/hooks/useChainEditor";

interface Props {
  catalog: NodeCatalogEntry[];
  insertAtIndex: number;
  dispatch: React.Dispatch<EditorAction>;
}

function kindColor(kind: string | undefined): string {
  if (kind === "skill") return "hsl(var(--kind-skill))";
  if (kind === "tool") return "hsl(var(--kind-tool))";
  return "hsl(var(--kind-trigger))";
}

function kindLabel(kind: string | undefined): string {
  if (kind === "skill") return "SKILL";
  if (kind === "tool") return "TOOL";
  return "NODE";
}

// Group entries by the namespace prefix (part before the first ".")
function groupByNamespace(entries: NodeCatalogEntry[]): Map<string, NodeCatalogEntry[]> {
  const map = new Map<string, NodeCatalogEntry[]>();
  for (const entry of entries) {
    const ns = entry.id.includes(".") ? entry.id.split(".")[0]! : entry.id;
    const group = map.get(ns) ?? [];
    group.push(entry);
    map.set(ns, group);
  }
  return map;
}

export function NodePalette({ catalog, insertAtIndex, dispatch }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? catalog.filter(
        (e) =>
          e.id.toLowerCase().includes(search.toLowerCase()) ||
          (e.description ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : catalog;

  const groups = groupByNamespace(filtered);

  if (collapsed) {
    return (
      <div
        className="border-r bg-background flex flex-col items-center py-3 gap-3 shrink-0"
        style={{ width: 40 }}
      >
        <button
          onClick={() => setCollapsed(false)}
          aria-label="Expand palette"
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Expand palette"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div
          className="text-[9px] font-semibold tracking-widest text-muted-foreground"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          NODES
        </div>
      </div>
    );
  }

  return (
    <div
      className="border-r bg-background flex flex-col shrink-0 overflow-hidden"
      style={{ width: 260 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Nodes
        </span>
        <button
          onClick={() => setCollapsed(true)}
          aria-label="Collapse palette"
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Collapse palette"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b">
        <input
          type="search"
          placeholder="Search nodes…"
          aria-label="Search nodes"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full text-xs rounded border border-border bg-background px-2 py-1.5 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[hsl(var(--accent-flow))]"
        />
      </div>

      {/* Node list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {groups.size === 0 && (
          <p className="text-xs text-muted-foreground px-1">No nodes match.</p>
        )}
        {Array.from(groups.entries()).map(([ns, entries]) => (
          <div key={ns}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-1">
              {ns}
            </p>
            <div className="space-y-1">
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  className="w-full text-left rounded-md border border-border bg-background hover:bg-muted transition-colors overflow-hidden flex items-stretch"
                  style={{ minHeight: 44 }}
                  onClick={() =>
                    dispatch({
                      type: "INSERT_STEP",
                      nodeId: entry.id,
                      atIndex: insertAtIndex,
                    })
                  }
                  title={entry.description}
                >
                  {/* Kind rail chip */}
                  <div
                    aria-hidden="true"
                    style={{
                      width: 4,
                      flexShrink: 0,
                      background: kindColor(entry.kind),
                      borderRadius: "4px 0 0 4px",
                    }}
                  />
                  <div className="flex-1 px-2 py-2 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="text-[9px] font-bold tracking-wider shrink-0"
                        style={{ color: kindColor(entry.kind) }}
                      >
                        {kindLabel(entry.kind)}
                      </span>
                      <span className="font-mono text-xs font-medium truncate">
                        {entry.id}
                      </span>
                    </div>
                    {entry.description && (
                      <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {entry.description}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
