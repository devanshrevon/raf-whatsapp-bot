import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

async function logEvent(leadId: string, eventType: string, detail?: Prisma.InputJsonValue) {
  await db.systemEvent.create({ data: { leadId, eventType, detail: detail ?? {} } });
}

export async function setBotPaused(leadId: string, paused: boolean) {
  await db.lead.update({ where: { id: leadId }, data: { botPaused: paused } });
  await logEvent(leadId, paused ? "bot_paused" : "bot_resumed");
}

export async function markCompleted(leadId: string) {
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });

  await db.$transaction([
    db.lead.update({ where: { id: leadId }, data: { status: "COMPLETED" } }),
    db.appointment.updateMany({
      where: { leadId, status: "BOOKED" },
      data: { status: "COMPLETED" }
    }),
    db.scheduledAction.updateMany({
      where: { leadId, status: "PENDING" },
      data: { status: "CANCELLED" }
    })
  ]);

  await logEvent(leadId, "marked_completed", { previousStatus: lead.status });
}

export async function markMissed(leadId: string) {
  const appointment = await db.appointment.findFirst({
    where: { leadId, status: "BOOKED" },
    orderBy: { startAt: "desc" }
  });

  await db.$transaction([
    db.lead.update({ where: { id: leadId }, data: { status: "MISSED" } }),
    ...(appointment
      ? [
          db.appointment.update({
            where: { id: appointment.id },
            data: { status: "MISSED" }
          })
        ]
      : []),
    db.scheduledAction.create({
      data: {
        leadId,
        actionType: "MISSED_CALLBACK",
        scheduledAt: new Date(),
        status: "PENDING"
      }
    })
  ]);

  await logEvent(leadId, "marked_missed", { appointmentId: appointment?.id ?? null });
}

export async function stopMessages(leadId: string) {
  await db.$transaction([
    db.lead.update({
      where: { id: leadId },
      data: { optedOut: true, status: "STOPPED" }
    }),
    db.scheduledAction.updateMany({
      where: { leadId, status: "PENDING" },
      data: { status: "CANCELLED" }
    })
  ]);

  await logEvent(leadId, "stopped_by_team");
}

/**
 * Booking/rescheduling requires the Google Calendar free/busy check described
 * in spec section 14. That integration is built in Phase 4 — this throws a
 * clear error so the dashboard can show "not available yet" rather than
 * silently doing nothing or faking a booking.
 */
export async function bookOrRescheduleCallback(): Promise<never> {
  throw new Error(
    "Calendar booking is not wired up yet — this ships in Phase 4 (Google Calendar integration)."
  );
}
