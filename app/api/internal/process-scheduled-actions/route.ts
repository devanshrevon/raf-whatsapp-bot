import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { processDueScheduledActions } from "@/lib/scheduled-actions/process";

export const dynamic = "force-dynamic";

/**
 * Railway cron calls this every 5–10 minutes (spec §17).
 * The secret-header check is real. The body processes all PENDING
 * scheduled_actions whose scheduledAt <= now.
 */
export async function POST(request: NextRequest) {
  const provided = request.headers.get("x-internal-secret");

  if (!provided || provided !== env.internalCronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processDueScheduledActions();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("process-scheduled-actions error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
