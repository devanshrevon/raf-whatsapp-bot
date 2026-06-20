import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { bookCallback, rescheduleCallback } from "@/lib/calendar/booking";
import { combineDateAndTime } from "@/lib/calendar/timezone";
import {
  scheduleAppointmentReminder,
  cancelPendingFollowUps,
} from "@/lib/scheduled-actions/process";

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
    // Only mark an appointment missed AND queue a "we couldn't reach you for
    // your scheduled call" follow-up when there actually was a booked call.
    // Otherwise that follow-up would reference a call that never existed.
    ...(appointment
      ? [
          db.appointment.update({
            where: { id: appointment.id },
            data: { status: "MISSED" }
          }),
          db.scheduledAction.create({
            data: {
              leadId,
              actionType: "MISSED_CALLBACK",
              scheduledAt: new Date(),
              status: "PENDING"
            }
          })
        ]
      : [])
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
 * Undo a stop / opt-out (e.g. the team stopped a lead by mistake, or the
 * customer asked to resume). Clears optedOut, sets the lead back to ACTIVE, and
 * resets the conversation stage so the bot can pick the conversation back up.
 * NOTE: only use when the customer genuinely wants to resume — re-enabling
 * messaging after a real opt-out is not permitted (spec §21).
 */
export async function reactivateLead(leadId: string) {
  await db.lead.update({
    where: { id: leadId },
    data: {
      optedOut: false,
      status: "ACTIVE",
      // Move off the terminal STOPPED stage so the engine resumes normally.
      conversationStage: "DISCOVERING_SITUATION"
    }
  });

  await logEvent(leadId, "reactivated_by_team");
}

/**
 * Book or reschedule a callback from the dashboard (spec §14, Phase 4).
 * dateStr = "YYYY-MM-DD", timeStr = "HH:MM" (Europe/London wall-clock).
 */
export async function bookOrRescheduleCallback(
  leadId: string,
  dateStr: string,
  timeStr: string
): Promise<void> {
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });

  const start = combineDateAndTime(dateStr, timeStr);
  if (!start) {
    throw new Error(`Invalid date/time: ${dateStr} ${timeStr}`);
  }

  // Check for an existing booked appointment to reschedule.
  const existing = await db.appointment.findFirst({
    where: { leadId, status: "BOOKED" },
    orderBy: { startAt: "desc" },
  });

  let newStart: Date;
  if (existing) {
    const appt = await rescheduleCallback(existing.id, start);
    newStart = appt.startAt;
    await logEvent(leadId, "appointment_changed", {
      appointmentId: appt.id,
      startAt: newStart.toISOString(),
      source: "dashboard",
    });
  } else {
    const appt = await bookCallback(lead, start);
    newStart = appt.startAt;
    await logEvent(leadId, "appointment_booked", {
      appointmentId: appt.id,
      startAt: newStart.toISOString(),
      source: "dashboard",
    });
  }

  // Cancel any pending incomplete-conversation follow-ups and schedule a reminder.
  await cancelPendingFollowUps(leadId);
  await scheduleAppointmentReminder(leadId, newStart);
}

/**
 * Temporary function for testing: completely deletes a lead and all associated
 * cascading records (messages, appointments, scheduled actions). Explicitly
 * deletes SystemEvents first as they do not cascade.
 */
export async function deleteLeadCompletely(leadId: string) {
  await db.$transaction([
    db.systemEvent.deleteMany({ where: { leadId } }),
    db.lead.delete({ where: { id: leadId } })
  ]);
}
