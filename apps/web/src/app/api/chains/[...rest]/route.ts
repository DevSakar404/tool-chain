import type { NextRequest } from "next/server";

/**
 * Catch-all fallback for unmatched paths under /api/chains/*.
 *
 * The only real endpoint is the dynamic POST route /api/chains/[id]/run.
 * Next.js prefers that more-specific match, so this handler only fires for
 * malformed paths — e.g. /api/chains/run (missing the chain id segment) or
 * /api/chains/<id> (missing /run). Instead of a bare 404, return a JSON
 * message that explains the correct shape.
 */
function explain(pathParts: string[] | undefined): Response {
  const got = `/api/chains/${(pathParts ?? []).join("/")}`;
  return new Response(
    JSON.stringify({
      error: "Not Found",
      message:
        "No such endpoint. The chain id is a required path segment: /api/chains/<chainId>/run",
      received: got,
      expected: "/api/chains/<chainId>/run",
      hint: "The chain id comes from NEXT_PUBLIC_RESUME_CHAIN_ID. Use POST with header 'x-run-secret' and body { \"fileId\": \"...\" }.",
    }),
    { status: 404, headers: { "Content-Type": "application/json" } },
  );
}

async function handler(
  _request: NextRequest,
  { params }: { params: Promise<{ rest: string[] }> },
): Promise<Response> {
  const { rest } = await params;
  return explain(rest);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
