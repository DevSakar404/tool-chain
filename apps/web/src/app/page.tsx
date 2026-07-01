"use client";

import { useEffect, useRef, useState } from "react";
import { ResultView } from "@/components/ResultView";
import { RunStatusCard } from "@/components/RunStatusCard";
import type { ResumeDTO } from "@tool-chain/core";

interface RunEvent {
  event: "step" | "done" | "error";
  data: unknown;
}

export default function HomePage() {
  const [fileId, setFileId] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<ResumeDTO | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [totalTokens, setTotalTokens] = useState<number | null>(null);
  const [stepLog, setStepLog] = useState<string[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const chainId = process.env["NEXT_PUBLIC_RESUME_CHAIN_ID"] ?? "";

  function startTimer() {
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - (startedAtRef.current ?? Date.now()));
    }, 100);
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (startedAtRef.current !== null) {
      setElapsedMs(Date.now() - startedAtRef.current);
    }
  }

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fileId.trim()) return;

    setStatus("running");
    setResult(null);
    setErrorMsg(null);
    setTotalTokens(null);
    setStepLog([]);
    startTimer();

    try {
      const res = await fetch(`/api/chains/${chainId}/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-run-secret": process.env["NEXT_PUBLIC_RUN_API_SECRET"] ?? "",
        },
        body: JSON.stringify({ fileId }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
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
          const raw = line.slice(6);
          let evt: RunEvent;
          try {
            evt = JSON.parse(raw) as RunEvent;
          } catch {
            continue;
          }

          if (evt.event === "step") {
            const stepEvt = evt.data as { stepId: string; status: "running" | "ok" | "error" };
            setStepLog((prev) => [...prev, `Step ${stepEvt.stepId}: ${stepEvt.status}`]);
          } else if (evt.event === "done") {
            const doneData = evt.data as {
              ok: boolean;
              output?: ResumeDTO;
              error?: { message: string };
              totalTokens?: number;
            };
            stopTimer();
            if (typeof doneData.totalTokens === "number") {
              setTotalTokens(doneData.totalTokens);
            }
            if (doneData.ok && doneData.output) {
              setResult(doneData.output);
              setStatus("done");
            } else {
              setErrorMsg(doneData.error?.message ?? "Unknown error");
              setStatus("error");
            }
          } else if (evt.event === "error") {
            const errData = evt.data as { message: string };
            stopTimer();
            setErrorMsg(errData.message);
            setStatus("error");
          }
        }
      }
    } catch (e) {
      stopTimer();
      setErrorMsg(e instanceof Error ? e.message : "Unknown error");
      setStatus("error");
    }
  }

  return (
    <main className="container mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight mb-2">Resume Parser</h1>
      <p className="text-muted-foreground mb-8">
        Enter a Google Drive file ID (PDF or Google Doc) to extract and parse the resume.
      </p>

      <form onSubmit={handleSubmit} className="flex gap-3 mb-8">
        <input
          id="file-id-input"
          type="text"
          value={fileId}
          onChange={(e) => setFileId(e.target.value)}
          placeholder="Google Drive file ID"
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={status === "running"}
        />
        <button
          id="run-chain-button"
          type="submit"
          disabled={status === "running" || !fileId.trim()}
          className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {status === "running" ? "Running…" : "Run"}
        </button>
      </form>

      <RunStatusCard
        status={status}
        stepLog={stepLog}
        elapsedMs={elapsedMs}
        errorMsg={errorMsg}
        totalTokens={totalTokens}
      />

      {/* gen-UI swap point — isolated ResultView */}
      <ResultView resume={result} />
    </main>
  );
}
