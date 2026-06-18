import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status");
  const validStatuses = ["BOOKED", "MISSED", "COMPLETED", "CANCELLED"] as const;
  const statusFilter = validStatuses.find((s) => s === status);

  const appointments = await db.appointment.findMany({
    where: statusFilter ? { status: statusFilter } : undefined,
    orderBy: { startAt: "desc" },
    take: 300,
    include: { lead: { select: { id: true, preferredName: true, phoneNumber: true } } }
  });

  return NextResponse.json({ appointments });
}

/**
 * Creating a real appointment requires the Google Calendar free/busy check
 * and event-creation flow in spec section 14 — that's Phase 4. This stub
 * exists so the route is in place without risking a fake/unconfirmed booking.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Not implemented yet — Phase 4 (Google Calendar integration)." },
    { status: 501 }
  );
}
