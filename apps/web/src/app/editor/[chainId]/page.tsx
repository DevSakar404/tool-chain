"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { ChainEditor } from "@/components/editor/ChainEditor";
import { useChainEditor } from "@/hooks/useChainEditor";
import type { Chain, NodeCatalogEntry } from "@tool-chain/core";

const API_SECRET = process.env["NEXT_PUBLIC_RUN_API_SECRET"] ?? "";

async function fetchChain(chainId: string): Promise<Chain> {
  const res = await fetch(`/api/chains/${chainId}`, {
    headers: { "x-run-secret": API_SECRET },
  });
  if (!res.ok) throw new Error(`Chain fetch failed: ${res.status}`);
  const data = (await res.json()) as { chain: Chain };
  return data.chain;
}

async function fetchCatalog(): Promise<NodeCatalogEntry[]> {
  const res = await fetch("/api/nodes", {
    headers: { "x-run-secret": API_SECRET },
  });
  if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);
  const data = (await res.json()) as { nodes: NodeCatalogEntry[] };
  return data.nodes;
}

// Historical pacing data for the run progress bar — best-effort. No past runs
// yet (or a transient error) just means the bar falls back to real-time-only
// progress, so failures here must never block the editor from loading.
async function fetchStepAverages(chainId: string): Promise<Record<string, number>> {
  try {
    const res = await fetch(`/api/chains/${chainId}/step-averages`, {
      headers: { "x-run-secret": API_SECRET },
    });
    if (!res.ok) return {};
    const data = (await res.json()) as { averageMsByStepId: Record<string, number> };
    return data.averageMsByStepId;
  } catch {
    return {};
  }
}

export default function EditorPage() {
  const { chainId } = useParams<{ chainId: string }>();
  const { state, dispatch } = useChainEditor();

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchChain(chainId), fetchCatalog(), fetchStepAverages(chainId)])
      .then(([chain, catalog, stepAverages]) => {
        if (!cancelled) dispatch({ type: "LOAD", chain, catalog, stepAverages });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Failed to load editor";
          dispatch({ type: "LOAD_ERROR", message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [chainId, dispatch]);

  if (state.loadError) {
    return (
      <div className="flex items-center justify-center h-screen text-destructive">
        {state.loadError}
      </div>
    );
  }

  if (!state.chain) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        Loading chain…
      </div>
    );
  }

  return <ChainEditor state={state} dispatch={dispatch} />;
}
