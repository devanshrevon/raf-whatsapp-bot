import { z } from "zod";

export const appointmentStatusUpdateSchema = z.object({
  status: z.enum(["MISSED", "COMPLETED", "CANCELLED"])
});

export const createAppointmentSchema = z.object({
  leadId: z.string().min(1),
  // ISO 8601 instant for the slot start (e.g. "2026-06-09T16:00:00.000Z").
  startAt: z.string().datetime()
});

export const rescheduleSchema = z.object({
  startAt: z.string().datetime()
});
