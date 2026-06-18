import type { Appointment, Lead } from "@prisma/client";
import { db } from "@/lib/db";
import {
  createCalendarEvent,
  getBusyIntervals,
  updateCalendarEvent,
} from "@/lib/calendar/google";
import { buildEventDescription, buildEventSummary } from "@/lib/calendar/event-content";
import { isSlotFree, isWithinBusinessHours, SLOT_DEFAULTS } from "@/lib/calendar/slots";

// Create / reschedule a callback (spec §14, §15). Order is critical: re-check
// availability, create the calendar event, and ONLY THEN write the Appointment
// row. We never confirm a booking the calendar hasn't accepted.

const DURATION_MIN = SLOT_DEFAULTS.durationMinutes;

export class SlotUnavailableError extends Error {
  constructor() {
    super("That time is no longer available.");
    this.name = "SlotUnavailableError";
  }
}

async function assertSlotBookable(start: Date): Promise<Date> {
  const end = new Date(start.getTime() + DURATION_MIN * 60_000);
  if (!isWithinBusinessHours(start, DURATION_MIN)) {
    throw new SlotUnavailableError();
  }
  // Re-check against the live calendar right before committing (spec §14).
  const busy = await getBusyIntervals(start, end);
  if (!isSlotFree(start, busy, DURATION_MIN)) {
    throw new SlotUnavailableError();
  }
  return end;
}

/** Book a brand-new callback for a lead at the given start instant. */
export async function bookCallback(lead: Lead, start: Date): Promise<Appointment> {
  const end = await assertSlotBookable(start);

  // Create the Google event first; if this throws, nothing is persisted.
  const eventId = await createCalendarEvent({
    summary: buildEventSummary(lead),
    description: buildEventDescription(lead),
    start,
    end,
  });

  const appointment = await db.appointment.create({
    data: {
      leadId: lead.id,
      googleEventId: eventId,
      startAt: start,
      endAt: end,
      status: "BOOKED",
    },
  });

  await db.lead.update({
    where: { id: lead.id },
    data: { status: "BOOKED", conversationStage: "APPOINTMENT_BOOKED" },
  });

  await db.systemEvent.create({
    data: {
      leadId: lead.id,
      eventType: "appointment_booked",
      detail: { appointmentId: appointment.id, startAt: start.toISOString() },
    },
  });

  return appointment;
}

/** Move an existing appointment to a new start instant (spec §16.3 reschedule). */
export async function rescheduleCallback(
  appointmentId: string,
  start: Date
): Promise<Appointment> {
  const existing = await db.appointment.findUniqueOrThrow({
    where: { id: appointmentId },
  });
  const end = await assertSlotBookable(start);

  await updateCalendarEvent(existing.googleEventId, { start, end });

  const appointment = await db.appointment.update({
    where: { id: appointmentId },
    data: { startAt: start, endAt: end, status: "BOOKED" },
  });

  await db.lead.update({
    where: { id: existing.leadId },
    data: { status: "BOOKED", conversationStage: "APPOINTMENT_BOOKED" },
  });

  await db.systemEvent.create({
    data: {
      leadId: existing.leadId,
      eventType: "appointment_changed",
      detail: { appointmentId, startAt: start.toISOString() },
    },
  });

  return appointment;
}
