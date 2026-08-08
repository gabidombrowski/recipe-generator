import { NextResponse } from "next/server";
import { connection, resolveDbPath } from "~/server/db/index";

/**
 * Liveness and readiness in one endpoint.
 *
 * Unauthenticated by design — it is what the container health check and the
 * Prometheus blackbox probe call, neither of which can hold a session. It
 * deliberately reports no personal data: whether the database answers, whether
 * the vector extension loaded, and nothing else.
 */
export const dynamic = "force-dynamic";

export function GET() {
  try {
    // A real query, not just a connection object: this catches a database file
    // that has gone read-only or been deleted out from under the process.
    connection.sqlite.prepare("SELECT 1").get();

    return NextResponse.json(
      {
        status: "ok",
        database: "ok",
        vectorSearch: connection.vectorSearchAvailable ? "ok" : "unavailable",
        uptimeSeconds: Math.round(process.uptime()),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        database: "unreachable",
        detail: error instanceof Error ? error.message : "unknown error",
        dbPath: resolveDbPath(),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
