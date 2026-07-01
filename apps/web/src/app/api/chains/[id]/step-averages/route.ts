import "server-only";
import type { NextRequest } from "next/server";
import { getEngineBundle } from "@/lib/engineSingleton";

const RECENT_RUNS_LIMIT = 20;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const secret = request.headers.get("x-run-secret");
  if (!secret || secret !== process.env["RUN_API_SECRET"]) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { id: chainId } = await params;
  const { runRepository } = getEngineBundle();
  const durations = await runRepository.listRecentStepDurations(chainId, RECENT_RUNS_LIMIT);

  const totals = new Map<string, { sum: number; count: number }>();
  for (const { stepId, durationMs } of durations) {
    const entry = totals.get(stepId) ?? { sum: 0, count: 0 };
    entry.sum += durationMs;
    entry.count += 1;
    totals.set(stepId, entry);
  }

  const averageMsByStepId: Record<string, number> = {};
  for (const [stepId, { sum, count }] of totals) {
    averageMsByStepId[stepId] = Math.round(sum / count);
  }

  return new Response(JSON.stringify({ averageMsByStepId }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
