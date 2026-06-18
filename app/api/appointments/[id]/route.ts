import { NextRequest, NextResponse } from "next/server";
import {
  appointmentStatusUpdateSchema,
  rescheduleSchema,
} from "@/lib/appointments/schema";
import { updateAppointmentStatus } from "@/lib/appointments/mutations";
import { rescheduleCallback, SlotUnavailableError } from "@/lib/calendar/booking";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json().catch(() => null);

  // Reschedule (move the start time) — spec §16.3.
  const reschedule = rescheduleSchema.safeParse(body);
  if (reschedule.success) {
    try {
      const appointment = await rescheduleCallback(
        params.id,
        new Date(reschedule.data.startAt)
      );
      return NextResponse.json({ appointment });
    } catch (error) {
      if (error instanceof SlotUnavailableError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      return NextResponse.json(
        { error: "Reschedule failed — calendar unavailable." },
        { status: 502 }
      );
    }
  }

  // Status change — mark missed / completed / cancelled.
  const statusUpdate = appointmentStatusUpdateSchema.safeParse(body);
  if (statusUpdate.success) {
    try {
      const appointment = await updateAppointmentStatus(
        params.id,
        statusUpdate.data.status
      );
      return NextResponse.json({ appointment });
    } catch {
      return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
    }
  }

  return NextResponse.json(
    { error: "Invalid request — provide a status or a startAt to reschedule." },
    { status: 400 }
  );
}
