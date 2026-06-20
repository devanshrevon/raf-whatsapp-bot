import type { Lead, ScheduledAction } from "@prisma/client";
import { db } from "@/lib/db";
import { sendWhatsAppMessage } from "@/lib/twilio/send-message";
import { formatLondonSlot } from "@/lib/calendar/timezone";

// Phase 5: follow-up processing loop (spec §17). Called from
// app/api/internal/process-scheduled-actions/route.ts on every cron tick.
// Claim → check guards → send → mark done. Retry up to 3 times then FAILED.

const MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Message builders — plain approved wording (spec §16).
// Business sign-offs needed: exact delay timings are env-configurable defaults.
// ---------------------------------------------------------------------------

function buildIncompleteConversationMessage(lead: Lead): string {
  const name = lead.preferredName ? `, ${lead.preferredName}` : "";
  return `Hi${name}, just checking whether you still wanted to continue. We can pick up from where we left off whenever you're ready.`;
}

function buildAppointmentReminderMessage(
  lead: Lead,
  appointment: { startAt: Date } | null
): string {
  const name = lead.preferredName ? `, ${lead.preferredName}` : "";
  if (appointment) {
    return `Hi${name}, just a reminder that someone from the team will call you ${formatLondonSlot(appointment.startAt)}.`;
  }
  return `Hi${name}, just a reminder that someone from Raf's team has a callback scheduled with you. They'll be in touch soon.`;
}

function buildMissedCallbackMessage(lead: Lead): string {
  const name = lead.preferredName ? `, ${lead.preferredName}` : "";
  return `Hi${name}, it looks like the team couldn't reach you for your scheduled call. Would you like me to check another time that works for you?`;
}

// ---------------------------------------------------------------------------
// Guard checks — every action checks these before sending (spec §17)
// ---------------------------------------------------------------------------

async function shouldSkipAction(
  lead: Lead,
  action: ScheduledAction
): Promise<{ skip: boolean; reason: string }> {
  // Opt-out: never send.
  if (lead.optedOut) return { skip: true, reason: "opted_out" };

  // Bot paused by team: skip (not fail — resume will re-enable naturally).
  if (lead.botPaused) return { skip: true, reason: "bot_paused" };

  // Serious vulnerability: pause ordinary follow-ups (spec §20).
  if (lead.vulnerabilityLevel >= 2 && action.actionType !== "MISSED_CALLBACK") {
    return { skip: true, reason: "vulnerability_hold" };
  }

  // Lead already completed or stopped: cancel all.
  if (lead.status === "COMPLETED" || lead.status === "STOPPED") {
    return { skip: true, reason: "lead_closed" };
  }

  // INCOMPLETE_CONVERSATION: skip if customer has replied since this was due to
  // fire. We compare against scheduledAt (not createdAt) because lastCustomer-
  // MessageAt is written during the same inbound turn that creates this action,
  // so it is always <= createdAt — making the createdAt comparison ineffective
  // when the customer replies continuously.
  if (action.actionType === "INCOMPLETE_CONVERSATION") {
    if (
      lead.lastCustomerMessageAt &&
      lead.lastCustomerMessageAt >= action.scheduledAt
    ) {
      return { skip: true, reason: "customer_replied" };
    }
  }

  // APPOINTMENT_REMINDER: skip if appointment already completed or cancelled.
  if (action.actionType === "APPOINTMENT_REMINDER") {
    const appt = await db.appointment.findFirst({
      where: {
        leadId: lead.id,
        status: { in: ["COMPLETED", "CANCELLED"] },
      },
    });
    if (appt) return { skip: true, reason: "appointment_no_longer_active" };
  }

  return { skip: false, reason: "" };
}

// ---------------------------------------------------------------------------
// Single-action processor
// ---------------------------------------------------------------------------

async function processAction(action: ScheduledAction): Promise<void> {
  // Load the freshest lead state (may have changed since the action was queued).
  const lead = await db.lead.findUnique({ where: { id: action.leadId } });
  if (!lead) {
    // Lead was deleted — cancel the action.
    await db.scheduledAction.update({
      where: { id: action.id },
      data: { status: "CANCELLED", completedAt: new Date() },
    });
    return;
  }

  const { skip, reason } = await shouldSkipAction(lead, action);
  if (skip) {
    // Mark CANCELLED (not FAILED) — this is a deliberate business-rule skip.
    await db.scheduledAction.update({
      where: { id: action.id },
      data: { status: "CANCELLED", completedAt: new Date(), lastError: reason },
    });
    return;
  }

  // Build the message body.
  let body: string;
  try {
    if (action.actionType === "INCOMPLETE_CONVERSATION") {
      body = buildIncompleteConversationMessage(lead);
    } else if (action.actionType === "APPOINTMENT_REMINDER") {
      const appt = await db.appointment.findFirst({
        where: { leadId: lead.id, status: "BOOKED" },
        orderBy: { startAt: "asc" },
      });
      body = buildAppointmentReminderMessage(lead, appt);
    } else {
      // MISSED_CALLBACK
      body = buildMissedCallbackMessage(lead);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failOrRetry(action, `build_message_error: ${msg}`);
    return;
  }

  // Pre-send ownership check: confirm the row is still PROCESSING at this
  // exact moment. If the inbound webhook cancelled it between shouldSkipAction
  // and here (Timeline C), this update matches 0 rows and we abort silently —
  // no schema migration needed since we write PROCESSING → PROCESSING (a
  // no-op value, but Postgres still serialises the write and returns count).
  const preSend = await db.scheduledAction.updateMany({
    where: { id: action.id, status: "PROCESSING" },
    data: { status: "PROCESSING" },
  });
  if (preSend.count === 0) return; // cancelled out from under us — abort

  // Send via Twilio.
  try {
    await sendWhatsAppMessage({
      leadId: lead.id,
      to: lead.phoneNumber,
      body,
      senderType: "BOT",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failOrRetry(action, `send_error: ${msg}`);

    // Log the Twilio failure.
    await db.systemEvent.create({
      data: {
        leadId: lead.id,
        eventType: "external_api_failure",
        detail: { where: "twilio_send", message: msg, actionId: action.id },
      },
    });
    return;
  }

  // Increment follow-up counter on the lead.
  await db.lead.update({
    where: { id: lead.id },
    data: { followUpCount: { increment: 1 } },
  });

  // Log the follow-up as a system event.
  await db.systemEvent.create({
    data: {
      leadId: lead.id,
      eventType: "follow_up_sent",
      detail: { actionType: action.actionType, actionId: action.id },
    },
  });

  // Mark completed.
  await db.scheduledAction.update({
    where: { id: action.id },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

async function failOrRetry(action: ScheduledAction, error: string): Promise<void> {
  const nextAttempt = action.attemptCount + 1;

  if (nextAttempt >= MAX_ATTEMPTS) {
    await db.scheduledAction.update({
      where: { id: action.id },
      data: {
        status: "FAILED",
        attemptCount: nextAttempt,
        lastError: error,
        completedAt: new Date(),
      },
    });
    return;
  }

  // Retry with exponential back-off: 5 min, 15 min, then FAILED.
  const backoffMs = [5 * 60_000, 15 * 60_000][action.attemptCount] ?? 15 * 60_000;
  const retryAt = new Date(Date.now() + backoffMs);

  await db.scheduledAction.update({
    where: { id: action.id },
    data: {
      status: "PENDING",
      scheduledAt: retryAt,
      attemptCount: nextAttempt,
      lastError: error,
    },
  });
}

// ---------------------------------------------------------------------------
// Public entry-point: claim all due PENDING actions and process them.
// ---------------------------------------------------------------------------

export type ProcessResult = {
  processed: number;
  cancelled: number;
  failed: number;
  errors: string[];
};

export async function processDueScheduledActions(): Promise<ProcessResult> {
  const result: ProcessResult = {
    processed: 0,
    cancelled: 0,
    failed: 0,
    errors: [],
  };

  // Find due PENDING actions. This is only a candidate list — each one is then
  // claimed atomically below, so it's safe even if another cron run reads the
  // same candidates at the same time.
  const now = new Date();
  const candidates = await db.scheduledAction.findMany({
    where: { status: "PENDING", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: 50, // safety cap per cron tick
  });

  if (candidates.length === 0) return result;

  for (const candidate of candidates) {
    // Atomic claim (spec §17): a guarded UPDATE ... WHERE id = ? AND status =
    // 'PENDING'. Postgres serialises concurrent updates on the row, so exactly
    // one worker flips PENDING -> PROCESSING (count === 1); any other worker
    // sees status already PROCESSING (count === 0) and skips it. This is what
    // prevents two cron ticks from sending the same follow-up twice.
    const claim = await db.scheduledAction.updateMany({
      where: { id: candidate.id, status: "PENDING" },
      data: { status: "PROCESSING" },
    });
    if (claim.count === 0) continue; // another worker already claimed it

    // We now own this action. Re-read it so the processor sees current state.
    const fresh = await db.scheduledAction.findUnique({ where: { id: candidate.id } });
    if (!fresh) continue;

    try {
      await processAction(fresh);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`action:${candidate.id} ${msg}`);
      // Fall back to pending-retry so nothing gets permanently stuck PROCESSING.
      await failOrRetry(fresh, `unexpected_error: ${msg}`).catch(() => {});
    }

    // Read final status to count outcomes.
    const final = await db.scheduledAction.findUnique({ where: { id: candidate.id } });
    const status = final?.status;
    if (status === "COMPLETED") result.processed++;
    else if (status === "CANCELLED") result.cancelled++;
    else if (status === "FAILED") result.failed++;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Scheduling helpers — called from the inbound webhook route.
// ---------------------------------------------------------------------------

// Default delays (env-var overridable). Raf needs to confirm these values.
const INCOMPLETE_DELAY_HOURS = Number(
  process.env.FOLLOWUP_INCOMPLETE_DELAY_HOURS ?? "24"
);
const REMINDER_BEFORE_HOURS = Number(
  process.env.FOLLOWUP_REMINDER_BEFORE_HOURS ?? "2"
);

/**
 * Schedule an INCOMPLETE_CONVERSATION follow-up after the configured delay.
 * Cancels any existing pending incomplete-conversation actions for this lead first
 * (no duplicate follow-ups).
 */
export async function scheduleIncompleteConversationFollowUp(
  leadId: string
): Promise<void> {
  // Cancel any existing pending or in-flight incomplete-conversation actions.
  // We cancel PROCESSING state too: if the cron claimed the action between two
  // customer replies, a subsequent reply must still suppress it — the guard in
  // shouldSkipAction can't help once the cron has already started the send.
  await db.scheduledAction.updateMany({
    where: {
      leadId,
      actionType: "INCOMPLETE_CONVERSATION",
      status: { in: ["PENDING", "PROCESSING"] },
    },
    data: { status: "CANCELLED" },
  });

  const scheduledAt = new Date(
    Date.now() + INCOMPLETE_DELAY_HOURS * 60 * 60_000
  );
  await db.scheduledAction.create({
    data: { leadId, actionType: "INCOMPLETE_CONVERSATION", scheduledAt },
  });
}

/**
 * Schedule an APPOINTMENT_REMINDER before the appointment start time.
 * Cancels any existing pending appointment-reminder actions for this lead first.
 */
export async function scheduleAppointmentReminder(
  leadId: string,
  appointmentStart: Date
): Promise<void> {
  // Cancel any existing pending reminder for this lead.
  await db.scheduledAction.updateMany({
    where: { leadId, actionType: "APPOINTMENT_REMINDER", status: "PENDING" },
    data: { status: "CANCELLED" },
  });

  // Don't schedule a reminder if the appointment is too soon.
  const reminderAt = new Date(
    appointmentStart.getTime() - REMINDER_BEFORE_HOURS * 60 * 60_000
  );
  if (reminderAt <= new Date()) return;

  await db.scheduledAction.create({
    data: { leadId, actionType: "APPOINTMENT_REMINDER", scheduledAt: reminderAt },
  });
}

/**
 * Cancel all pending follow-up actions for a lead (e.g. on opt-out, completion,
 * or when a customer resumes an incomplete conversation).
 */
export async function cancelPendingFollowUps(leadId: string): Promise<void> {
  await db.scheduledAction.updateMany({
    where: { leadId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
}
