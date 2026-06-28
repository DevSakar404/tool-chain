"use client";

import { useCallback, useState } from "react";

const API_SECRET = process.env["NEXT_PUBLIC_RUN_API_SECRET"] ?? "";

interface StepEvent { stepId: string; status: string }
interface DoneEvent { ok: boolean; output?: unknown; error?: { message: string } }
interface ErrorEvent { message: string }
type RunEvent =
  | { event: "step"; data: StepEvent }
  | { event: "done"; data: DoneEvent }
  | { event: "error"; data: ErrorEvent };

interface UseChainRunOptions {
  onStep: (stepId: string, status: string) => void;
  onDone: (result: unknown) => void;
  onError: (message: string) => void;
}

export function useChainRun({ onStep, onDone, onError }: UseChainRunOptions) {
  const [running, setRunning] = useState(false);

  const run = useCallback(
    async (chainId: string, trigger: Record<string, unknown>) => {
      setRunning(true);
      try {
        const res = await fetch(`/api/chains/${chainId}/run`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-run-secret": API_SECRET,
          },
          body: JSON.stringify(trigger),
        });

        if (!res.ok || !res.body) {
          onError(`HTTP ${res.status}`);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let evt: RunEvent;
            try {
              evt = JSON.parse(line.slice(6)) as RunEvent;
            } catch {
              continue;
            }

            if (evt.event === "step") {
              onStep(evt.data.stepId, evt.data.status);
            } else if (evt.event === "done") {
              if (evt.data.ok && evt.data.output !== undefined) {
                onDone(evt.data.output);
              } else {
                onError(evt.data.error?.message ?? "Run failed");
              }
            } else if (evt.event === "error") {
              onError(evt.data.message);
            }
          }
        }
      } catch (e) {
        onError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setRunning(false);
      }
    },
    [onStep, onDone, onError],
  );

  return { run, running };
}
