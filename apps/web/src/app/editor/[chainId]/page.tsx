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

export default function EditorPage() {
  const { chainId } = useParams<{ chainId: string }>();
  const { state, dispatch } = useChainEditor();

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchChain(chainId), fetchCatalog()])
      .then(([chain, catalog]) => {
        if (!cancelled) dispatch({ type: "LOAD", chain, catalog });
      })
      .catch((err: unknown) => {
        console.error("Editor load error", err);
      });
    return () => {
      cancelled = true;
    };
  }, [chainId, dispatch]);

  if (!state.chain) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        Loading chain…
      </div>
    );
  }

  return <ChainEditor state={state} dispatch={dispatch} />;
}
