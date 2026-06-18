import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createAppointmentSchema } from "@/lib/appointments/schema";
import { bookCallback, SlotUnavailableError } from "@/lib/calendar/booking";

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
 * Manually book a callback from the dashboard (spec §6, §14). Re-checks Google
 * Calendar availability and only confirms after the event is created.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = createAppointmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const lead = await db.lead.findUnique({ where: { id: parsed.data.leadId } });
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  try {
    const appointment = await bookCallback(lead, new Date(parsed.data.startAt));
    return NextResponse.json({ appointment }, { status: 201 });
  } catch (error) {
    if (error instanceof SlotUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: "Booking failed — calendar unavailable." },
      { status: 502 }
    );
  }
}
