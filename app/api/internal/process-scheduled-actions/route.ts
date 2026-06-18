import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

/**
 * Railway cron calls this every 5–10 minutes (spec section 17).
 * The secret-header check is real and live now. The actual processing loop
 * (claim PENDING scheduled_actions, check opt-out/pause/appointment state,
 * send the message, mark COMPLETED/FAILED) ships in Phase 5 — see
 * lib/scheduled-actions/process.ts.
 */
export async function POST(request: NextRequest) {
  const provided = request.headers.get("x-internal-secret");

  if (!provided || provided !== env.internalCronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    { error: "Not implemented yet — Phase 5 (follow-up processing)." },
    { status: 501 }
  );
}
