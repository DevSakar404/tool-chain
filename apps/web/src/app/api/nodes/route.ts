import "server-only";
import type { NextRequest } from "next/server";
import { describeNode } from "@tool-chain/core";
import { getEngineBundle } from "@/lib/engineSingleton";

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  const secret = request.headers.get("x-run-secret");
  if (!secret || secret !== process.env["RUN_API_SECRET"]) {
    return unauthorized();
  }

  const { registry } = getEngineBundle();
  const nodes = registry.list().map(describeNode);

  return new Response(JSON.stringify({ nodes }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
