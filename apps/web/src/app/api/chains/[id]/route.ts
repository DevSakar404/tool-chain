import "server-only";
import type { NextRequest } from "next/server";
import { ChainSchema } from "@tool-chain/core";
import { getEngineBundle } from "@/lib/engineSingleton";

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const secret = request.headers.get("x-run-secret");
  if (!secret || secret !== process.env["RUN_API_SECRET"]) {
    return unauthorized();
  }

  const { id } = await params;
  const { chainRepository } = getEngineBundle();
  const chain = await chainRepository.findById(id);

  if (!chain) {
    return new Response(JSON.stringify({ error: "Chain not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ chain }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const secret = request.headers.get("x-run-secret");
  if (!secret || secret !== process.env["RUN_API_SECRET"]) {
    return unauthorized();
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsed = ChainSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Validation failed", issues: parsed.error.issues }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const chain = parsed.data;
  if (chain.id !== id) {
    return new Response(
      JSON.stringify({ error: "Chain id in body does not match path" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const { chainRepository } = getEngineBundle();
  await chainRepository.save(chain);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
