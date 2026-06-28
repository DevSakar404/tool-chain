"use client";

import type { NodeCatalogEntry } from "@tool-chain/core";
import type { EditorAction } from "@/hooks/useChainEditor";

interface Props {
  catalog: NodeCatalogEntry[];
  insertAtIndex: number;
  dispatch: React.Dispatch<EditorAction>;
}

export function NodePalette({ catalog, insertAtIndex, dispatch }: Props) {
  return (
    <div className="w-56 border-r bg-background overflow-y-auto p-3 space-y-2 shrink-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Add Node
      </p>
      {catalog.map((entry) => (
        <button
          key={entry.id}
          className="w-full text-left rounded-md border border-border px-3 py-2 text-xs hover:bg-muted transition-colors"
          onClick={() =>
            dispatch({
              type: "INSERT_STEP",
              nodeId: entry.id,
              atIndex: insertAtIndex,
            })
          }
        >
          <div className="font-mono font-medium truncate">{entry.id}</div>
          <div className="text-muted-foreground truncate">{entry.description}</div>
        </button>
      ))}
    </div>
  );
}
