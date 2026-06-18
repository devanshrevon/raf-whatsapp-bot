import { NextRequest, NextResponse } from "next/server";
import { appointmentStatusUpdateSchema } from "@/lib/appointments/schema";
import { updateAppointmentStatus } from "@/lib/appointments/mutations";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  const parsed = appointmentStatusUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const appointment = await updateAppointmentStatus(params.id, parsed.data.status);
    return NextResponse.json({ appointment });
  } catch {
    return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  }
}
