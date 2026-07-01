import "server-only";
import type { NextRequest } from "next/server";
import { getEngineBundle } from "@/lib/engineSingleton";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Auth gate (D15) — shared secret
  const secret = request.headers.get("x-run-secret");
  if (!secret || secret !== process.env["RUN_API_SECRET"]) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { id: chainId } = await params;

  let trigger: Record<string, unknown>;
  try {
    trigger = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Stream structured SSE events — each step fires in real-time via onStep callback
  const stream = new ReadableStream({
    async start(controller) {
      const encode = (data: unknown): Uint8Array =>
        new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);

      try {
        // getEngineBundle() runs composition-root wiring (buildEngine) on first
        // call, which throws synchronously on a misconfigured provider/key.
        // Constructing it inside this try, not before the stream starts, means
        // that failure surfaces as a graceful SSE "error" event instead of a
        // bare, bodyless 500 the client can't parse or explain to the user.
        const { engine } = getEngineBundle();
        const result = await engine.run(chainId, trigger, (evt) => {
          const data =
            evt.event === "step:running"
              ? { stepId: evt.stepId, status: "running" }
              : { stepId: evt.stepRun.stepId, status: evt.stepRun.status === "ok" ? "ok" : "error" };
          controller.enqueue(encode({ event: "step", data }));
        });

        controller.enqueue(
          encode({
            event: "done",
            data: {
              runId: result.runId,
              ok: result.ok,
              output: result.ok ? result.output : undefined,
              error: result.ok ? undefined : result.error,
              totalTokens: result.totalTokens,
            },
          }),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Internal error";
        controller.enqueue(encode({ event: "error", data: { message: msg } }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/**
 * GET on the run endpoint is not supported — this route executes a chain and
 * must be POSTed. Return a clear, actionable message instead of a bare 405 so
 * someone opening the URL in a browser understands how to call it correctly.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return new Response(
    JSON.stringify({
      error: "Method Not Allowed",
      message:
        "This endpoint runs a chain and only accepts POST. Send a POST request with the 'x-run-secret' header and a JSON body.",
      example: {
        method: "POST",
        url: `/api/chains/${id}/run`,
        headers: { "Content-Type": "application/json", "x-run-secret": "<RUN_API_SECRET>" },
        body: { fileId: "<google-drive-file-id>" },
      },
    }),
    { status: 405, headers: { "Content-Type": "application/json", Allow: "POST" } },
  );
}
