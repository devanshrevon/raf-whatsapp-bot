import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeLead } from "../helpers/lead";

// ── mocks (hoisted before imports) ───────────────────────────────────────────
vi.mock("@/lib/db", () => ({
  db: {
    lead: { findUnique: vi.fn(), update: vi.fn() },
    scheduledAction: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    appointment: { findFirst: vi.fn() },
    systemEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/twilio/send-message", () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ id: "msg_ok" }),
}));

// Static imports — mocks are already in place due to hoisting above
import {
  processDueScheduledActions,
  scheduleIncompleteConversationFollowUp,
  scheduleAppointmentReminder,
  cancelPendingFollowUps,
} from "@/lib/scheduled-actions/process";
import { db } from "@/lib/db";
import { sendWhatsAppMessage } from "@/lib/twilio/send-message";

// ── mock helpers ─────────────────────────────────────────────────────────────
type MockFn = ReturnType<typeof vi.fn>;
const mFindMany = () => db.scheduledAction.findMany as MockFn;
const mFindUnique = () => db.scheduledAction.findUnique as MockFn;
const mUpdateMany = () => db.scheduledAction.updateMany as MockFn;
const mUpdate = () => db.scheduledAction.update as MockFn;
const mLeadFind = () => db.lead.findUnique as MockFn;
const mLeadUpdate = () => db.lead.update as MockFn;
const mApptFind = () => db.appointment.findFirst as MockFn;
const mSysEvent = () => db.systemEvent.create as MockFn;
const mSend = () => sendWhatsAppMessage as MockFn;

function makeAction(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: "sa_1",
    leadId: "lead_1",
    actionType: "INCOMPLETE_CONVERSATION" as const,
    scheduledAt: new Date(now.getTime() - 10_000),
    status: "PENDING" as const,
    attemptCount: 0,
    lastError: null,
    createdAt: new Date(now.getTime() - 86400_000),
    completedAt: null,
    ...overrides,
  };
}

/**
 * Sets up all db mocks for a successful send path.
 * NOTE: db.scheduledAction.findUnique is called TWICE per action:
 *   1. To get the PROCESSING-state action before processAction
 *   2. To read final status for result counting
 * Use mockResolvedValueOnce for both calls in sequence.
 */
function setupSuccessfulSend(action: ReturnType<typeof makeAction>) {
  mFindMany().mockResolvedValue([action]);
  mUpdateMany().mockResolvedValue({ count: 1 });
  // Call 1: PROCESSING state (used by processAction)
  mFindUnique().mockResolvedValueOnce({ ...action, status: "PROCESSING" });
  // Call 2: final status for result counting
  mFindUnique().mockResolvedValueOnce({ ...action, status: "COMPLETED" });
  mLeadFind().mockResolvedValue(makeLead({ id: action.leadId }));
  mApptFind().mockResolvedValue(null);
  mLeadUpdate().mockResolvedValue({});
  mSysEvent().mockResolvedValue({});
  mUpdate().mockResolvedValue({ ...action, status: "COMPLETED", completedAt: new Date() });
  // Explicitly reset send mock so prior test's mockRejectedValue doesn't bleed in
  mSend().mockResolvedValue({ id: "msg_ok" });
}

function setupCancelPath(action: ReturnType<typeof makeAction>) {
  mFindMany().mockResolvedValue([action]);
  mUpdateMany().mockResolvedValue({ count: 1 });
  mFindUnique().mockResolvedValueOnce({ ...action, status: "PROCESSING" });
  mFindUnique().mockResolvedValueOnce({ ...action, status: "CANCELLED" });
  mUpdate().mockResolvedValue({ ...action, status: "CANCELLED" });
}

function setupFailedPath(action: ReturnType<typeof makeAction>) {
  mFindMany().mockResolvedValue([action]);
  mUpdateMany().mockResolvedValue({ count: 1 });
  mFindUnique().mockResolvedValueOnce({ ...action, status: "PROCESSING" });
  mFindUnique().mockResolvedValueOnce({ ...action, status: "FAILED" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── time gating ──────────────────────────────────────────────────────────────

describe("scheduling time gating", () => {
  it("returns zero counts when no actions are due (findMany returns empty)", async () => {
    mFindMany().mockResolvedValue([]);
    const result = await processDueScheduledActions();
    expect(result).toEqual({ processed: 0, cancelled: 0, failed: 0, errors: [] });
    expect(db.scheduledAction.updateMany).not.toHaveBeenCalled();
  });

  it("findMany is called with status=PENDING and scheduledAt lte filter", async () => {
    mFindMany().mockResolvedValue([]);
    await processDueScheduledActions();
    expect(db.scheduledAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "PENDING",
          scheduledAt: expect.objectContaining({ lte: expect.any(Date) }),
        }),
      })
    );
  });
});

// ── retry / backoff ──────────────────────────────────────────────────────────

describe("retry logic — Twilio send failure", () => {
  it("reschedules with ~5-minute backoff on first failure (attemptCount=0)", async () => {
    const action = makeAction({ attemptCount: 0 });
    mFindMany().mockResolvedValue([action]);
    mUpdateMany().mockResolvedValue({ count: 1 });
    mFindUnique().mockResolvedValueOnce({ ...action, status: "PROCESSING" });
    mFindUnique().mockResolvedValueOnce({ ...action, status: "PENDING", attemptCount: 1 });
    mLeadFind().mockResolvedValue(makeLead({ id: action.leadId }));
    mApptFind().mockResolvedValue(null);
    mSysEvent().mockResolvedValue({});
    mLeadUpdate().mockResolvedValue({});
    mSend().mockRejectedValue(new Error("Twilio 503"));
    mUpdate().mockResolvedValue({ ...action, status: "PENDING", attemptCount: 1 });

    await processDueScheduledActions();

    const updateCall = (db.scheduledAction.update as MockFn).mock.calls.find(
      (c) => c[0]?.data?.status === "PENDING"
    );
    expect(updateCall).toBeDefined();
    const scheduledAt: Date = updateCall?.[0]?.data?.scheduledAt;
    expect(scheduledAt instanceof Date).toBe(true);
    const diffMs = scheduledAt.getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(4 * 60_000);
    expect(diffMs).toBeLessThan(6 * 60_000);
  });

  it("reschedules with ~15-minute backoff on second failure (attemptCount=1)", async () => {
    const action = makeAction({ attemptCount: 1 });
    mFindMany().mockResolvedValue([action]);
    mUpdateMany().mockResolvedValue({ count: 1 });
    mFindUnique().mockResolvedValueOnce({ ...action, status: "PROCESSING" });
    mFindUnique().mockResolvedValueOnce({ ...action, status: "PENDING", attemptCount: 2 });
    mLeadFind().mockResolvedValue(makeLead({ id: action.leadId }));
    mApptFind().mockResolvedValue(null);
    mSysEvent().mockResolvedValue({});
    mLeadUpdate().mockResolvedValue({});
    mSend().mockRejectedValue(new Error("Twilio 503"));
    mUpdate().mockResolvedValue({ ...action, status: "PENDING", attemptCount: 2 });

    await processDueScheduledActions();

    const updateCall = (db.scheduledAction.update as MockFn).mock.calls.find(
      (c) => c[0]?.data?.status === "PENDING"
    );
    const scheduledAt: Date = updateCall?.[0]?.data?.scheduledAt;
    const diffMs = scheduledAt.getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(14 * 60_000);
    expect(diffMs).toBeLessThan(16 * 60_000);
  });

  it("sets status=FAILED after 3 failures (attemptCount=2)", async () => {
    const action = makeAction({ attemptCount: 2 });
    setupFailedPath(action);
    mLeadFind().mockResolvedValue(makeLead({ id: action.leadId }));
    mApptFind().mockResolvedValue(null);
    mSysEvent().mockResolvedValue({});
    mLeadUpdate().mockResolvedValue({});
    mSend().mockRejectedValue(new Error("Twilio 503"));
    mUpdate().mockResolvedValue({ ...action, status: "FAILED", attemptCount: 3, completedAt: new Date() });

    const result = await processDueScheduledActions();

    const failCall = (db.scheduledAction.update as MockFn).mock.calls.find(
      (c) => c[0]?.data?.status === "FAILED"
    );
    expect(failCall).toBeDefined();
    expect(failCall?.[0]?.data?.attemptCount).toBe(3);
    expect(failCall?.[0]?.data?.completedAt).toBeTruthy();
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(0);
  });
});

// ── guard cancellation — opted-out ───────────────────────────────────────────

describe("guard cancellation — opted-out lead", () => {
  it("cancels (not fails) the action when lead.optedOut=true", async () => {
    const action = makeAction();
    setupCancelPath(action);
    mLeadFind().mockResolvedValue(makeLead({ id: action.leadId, optedOut: true }));

    const result = await processDueScheduledActions();

    expect(result.cancelled).toBe(1);
    expect(mSend()).not.toHaveBeenCalled();
    const cancelCall = (db.scheduledAction.update as MockFn).mock.calls.find(
      (c) => c[0]?.data?.status === "CANCELLED"
    );
    expect(cancelCall).toBeDefined();
    expect(cancelCall?.[0]?.data?.lastError).toBe("opted_out");
  });
});

// ── guard cancellation — bot paused ─────────────────────────────────────────

describe("guard cancellation — bot paused", () => {
  it("cancels the action when lead.botPaused=true", async () => {
    const action = makeAction();
    setupCancelPath(action);
    mLeadFind().mockResolvedValue(makeLead({ id: action.leadId, botPaused: true }));

    const result = await processDueScheduledActions();

    expect(result.cancelled).toBe(1);
    expect(mSend()).not.toHaveBeenCalled();
    const cancelCall = (db.scheduledAction.update as MockFn).mock.calls.find(
      (c) => c[0]?.data?.status === "CANCELLED"
    );
    expect(cancelCall?.[0]?.data?.lastError).toBe("bot_paused");
  });
});

// ── guard cancellation — lead status ─────────────────────────────────────────

describe("guard cancellation — lead status closed", () => {
  it("cancels the action when lead.status=COMPLETED", async () => {
    const action = makeAction();
    setupCancelPath(action);
    mLeadFind().mockResolvedValue(makeLead({ id: action.leadId, status: "COMPLETED" }));

    const result = await processDueScheduledActions();
    expect(result.cancelled).toBe(1);
    expect(mSend()).not.toHaveBeenCalled();
  });

  it("cancels the action when lead.status=STOPPED", async () => {
    const action = makeAction();
    setupCancelPath(action);
    mLeadFind().mockResolvedValue(makeLead({ id: action.leadId, status: "STOPPED" }));

    const result = await processDueScheduledActions();
    expect(result.cancelled).toBe(1);
    expect(mSend()).not.toHaveBeenCalled();
  });
});

// ── guard cancellation — customer replied ─────────────────────────────────────

describe("guard cancellation — customer replied", () => {
  it("cancels INCOMPLETE_CONVERSATION when customer replied AFTER action scheduledAt", async () => {
    const now = new Date();
    const scheduledAt = new Date(now.getTime() - 10_000); // 10s ago (already due)
    const replyAt = new Date(now.getTime() - 5_000); // customer replied 5s ago, AFTER scheduledAt
    const action = makeAction({ actionType: "INCOMPLETE_CONVERSATION", scheduledAt });
    setupCancelPath(action);
    mLeadFind().mockResolvedValue(
      makeLead({ id: action.leadId, lastCustomerMessageAt: replyAt })
    );

    const result = await processDueScheduledActions();
    expect(result.cancelled).toBe(1);
    expect(mSend()).not.toHaveBeenCalled();
  });

  it("sends INCOMPLETE_CONVERSATION when customer replied BEFORE scheduledAt", async () => {
    const now = new Date();
    const scheduledAt = new Date(now.getTime() - 10_000); // already due
    const replyAt = new Date(now.getTime() - 60_000); // customer replied 60s ago, BEFORE scheduledAt
    const action = makeAction({ actionType: "INCOMPLETE_CONVERSATION", scheduledAt });
    setupSuccessfulSend(action);
    mLeadFind().mockResolvedValue(
      makeLead({ id: action.leadId, lastCustomerMessageAt: replyAt })
    );

    const result = await processDueScheduledActions();
    expect(mSend()).toHaveBeenCalledOnce();
    expect(result.processed).toBe(1);
  });

  it("regression (Bug 3): scheduleIncompleteConversationFollowUp cancels PROCESSING actions, not just PENDING", async () => {
    // The real failure scenario from the transcript:
    //   1. Customer message at T → webhook creates INCOMPLETE_CONVERSATION (PENDING, scheduledAt = T+1min)
    //   2. Cron fires at T+1min → atomically claims it: PENDING → PROCESSING
    //   3. Customer replies at T+1.5min → webhook calls scheduleIncompleteConversationFollowUp
    //   4. Old code: updateMany WHERE status=PENDING → matches nothing (action is PROCESSING) → send fires anyway
    //   5. New code: updateMany WHERE status IN (PENDING, PROCESSING) → cancels it in time
    //
    // We test the helper directly and assert it targets both statuses.
    await scheduleIncompleteConversationFollowUp("lead_1");
    expect(db.scheduledAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          leadId: "lead_1",
          actionType: "INCOMPLETE_CONVERSATION",
          status: { in: ["PENDING", "PROCESSING"] },
        }),
        data: { status: "CANCELLED" },
      })
    );
  });
});

// ── successful send ──────────────────────────────────────────────────────────

describe("successful action processing", () => {
  it("marks action COMPLETED, increments followUpCount, and creates system event", async () => {
    const action = makeAction();
    setupSuccessfulSend(action);

    const result = await processDueScheduledActions();

    expect(mSend()).toHaveBeenCalledOnce();
    expect(result.processed).toBe(1);

    const leadUpdateCall = (db.lead.update as MockFn).mock.calls.find(
      (c) => c[0]?.data?.followUpCount !== undefined
    );
    expect(leadUpdateCall).toBeDefined();

    expect(db.systemEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: "follow_up_sent" }),
      })
    );
  });

  it("send includes the lead phone number as 'to'", async () => {
    const action = makeAction();
    setupSuccessfulSend(action);
    mLeadFind().mockResolvedValue(makeLead({ id: action.leadId, phoneNumber: "+447911000001" }));

    await processDueScheduledActions();
    expect(mSend()).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+447911000001" })
    );
  });
});

// ── deleted lead ──────────────────────────────────────────────────────────────

describe("deleted lead handling", () => {
  it("cancels the action gracefully when lead no longer exists", async () => {
    const action = makeAction();
    mFindMany().mockResolvedValue([action]);
    mUpdateMany().mockResolvedValue({ count: 1 });
    mFindUnique().mockResolvedValueOnce({ ...action, status: "PROCESSING" });
    mFindUnique().mockResolvedValueOnce({ ...action, status: "CANCELLED" });
    mLeadFind().mockResolvedValue(null); // lead deleted
    mUpdate().mockResolvedValue({ ...action, status: "CANCELLED" });

    const result = await processDueScheduledActions();

    expect(mSend()).not.toHaveBeenCalled();
    const cancelCall = (db.scheduledAction.update as MockFn).mock.calls.find(
      (c) => c[0]?.data?.status === "CANCELLED"
    );
    expect(cancelCall).toBeDefined();
  });
});

// ── scheduling helpers ────────────────────────────────────────────────────────

describe("scheduleIncompleteConversationFollowUp", () => {
  beforeEach(() => {
    mUpdateMany().mockResolvedValue({ count: 0 });
    (db.scheduledAction.create as MockFn).mockResolvedValue({ id: "sa_new" });
  });

  it("cancels existing PENDING and PROCESSING INCOMPLETE_CONVERSATION actions first", async () => {
    await scheduleIncompleteConversationFollowUp("lead_1");
    expect(db.scheduledAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          leadId: "lead_1",
          actionType: "INCOMPLETE_CONVERSATION",
          status: { in: ["PENDING", "PROCESSING"] },
        }),
        data: { status: "CANCELLED" },
      })
    );
  });

  it("creates a new PENDING INCOMPLETE_CONVERSATION action", async () => {
    await scheduleIncompleteConversationFollowUp("lead_1");
    expect(db.scheduledAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leadId: "lead_1",
          actionType: "INCOMPLETE_CONVERSATION",
          scheduledAt: expect.any(Date),
        }),
      })
    );
  });

  it("schedules the action in the future", async () => {
    await scheduleIncompleteConversationFollowUp("lead_1");
    const createCall = (db.scheduledAction.create as MockFn).mock.calls[0];
    const scheduledAt: Date = createCall?.[0]?.data?.scheduledAt;
    expect(scheduledAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("scheduleAppointmentReminder", () => {
  beforeEach(() => {
    mUpdateMany().mockResolvedValue({ count: 0 });
    (db.scheduledAction.create as MockFn).mockResolvedValue({ id: "sa_rem" });
  });

  it("cancels existing PENDING APPOINTMENT_REMINDER actions first", async () => {
    const futureAppt = new Date(Date.now() + 5 * 60 * 60_000); // 5 hours from now
    await scheduleAppointmentReminder("lead_1", futureAppt);
    expect(db.scheduledAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          leadId: "lead_1",
          actionType: "APPOINTMENT_REMINDER",
          status: "PENDING",
        }),
      })
    );
  });

  it("creates a reminder scheduled BEFORE the appointment (2 hours before by default)", async () => {
    const futureAppt = new Date(Date.now() + 5 * 60 * 60_000);
    await scheduleAppointmentReminder("lead_1", futureAppt);
    const createCall = (db.scheduledAction.create as MockFn).mock.calls[0];
    const scheduledAt: Date = createCall?.[0]?.data?.scheduledAt;
    expect(scheduledAt.getTime()).toBeLessThan(futureAppt.getTime());
    // Should be ~3 hours from now (5 hours - 2 hours)
    const diffToNow = scheduledAt.getTime() - Date.now();
    expect(diffToNow).toBeGreaterThan(2.5 * 60 * 60_000);
  });

  it("does NOT create a reminder when appointment is too soon (reminderAt already past)", async () => {
    const tooSoonAppt = new Date(Date.now() + 30 * 60_000); // only 30 min away
    await scheduleAppointmentReminder("lead_1", tooSoonAppt);
    // Reminder would be at -90 min (past) — should not create
    expect(db.scheduledAction.create).not.toHaveBeenCalled();
  });
});

describe("cancelPendingFollowUps", () => {
  it("cancels all PENDING actions for the given lead", async () => {
    mUpdateMany().mockResolvedValue({ count: 3 });
    await cancelPendingFollowUps("lead_xyz");
    expect(db.scheduledAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ leadId: "lead_xyz", status: "PENDING" }),
        data: { status: "CANCELLED" },
      })
    );
  });
});

// ── concurrency: atomic claim ────────────────────────────────────────────────

describe("atomic claim (no double-processing)", () => {
  it("claims each action with a status-guarded update", async () => {
    const action = makeAction();
    setupSuccessfulSend(action);
    await processDueScheduledActions();
    // The claim must be guarded on status PENDING for that specific id.
    expect(db.scheduledAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: action.id, status: "PENDING" }),
        data: { status: "PROCESSING" },
      })
    );
  });

  it("skips an action another worker already claimed (claim count 0) — no send", async () => {
    const action = makeAction();
    mFindMany().mockResolvedValue([action]);
    // Another worker won the race: our guarded update affects 0 rows.
    mUpdateMany().mockResolvedValue({ count: 0 });

    const result = await processDueScheduledActions();

    expect(mSend()).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 0, cancelled: 0, failed: 0, errors: [] });
  });

  it("regression (Timeline C): does NOT send when inbound webhook cancels action between shouldSkipAction and sendWhatsAppMessage", async () => {
    // Reproduces the exact race:
    //   1. Cron claims action: PENDING → PROCESSING (count=1)
    //   2. Cron re-reads action: sees PROCESSING, calls processAction
    //   3. processAction reads lead — looks fine, shouldSkipAction passes
    //   4. Inbound webhook arrives, sets row to CANCELLED
    //   5. Pre-send guard: updateMany WHERE status=PROCESSING → count=0 (already CANCELLED)
    //   6. Cron aborts — sendWhatsAppMessage must NOT be called
    const action = makeAction();

    mFindMany().mockResolvedValue([action]);

    // Call 1 (atomic claim): count=1 — cron claims it
    // Call 2 (pre-send guard): count=0 — inbound webhook already cancelled it
    mUpdateMany()
      .mockResolvedValueOnce({ count: 1 })  // atomic claim succeeds
      .mockResolvedValueOnce({ count: 0 }); // pre-send guard: row no longer PROCESSING

    // Cron re-reads after claim: PROCESSING
    mFindUnique().mockResolvedValueOnce({ ...action, status: "PROCESSING" });
    // Final status read: CANCELLED (webhook got there first)
    mFindUnique().mockResolvedValueOnce({ ...action, status: "CANCELLED" });

    // Lead reads fine — shouldSkipAction passes
    mLeadFind().mockResolvedValue(makeLead({ id: action.leadId }));
    mApptFind().mockResolvedValue(null);
    mSysEvent().mockResolvedValue({});

    const result = await processDueScheduledActions();

    expect(mSend()).not.toHaveBeenCalled();
    expect(result.cancelled).toBe(1);
    expect(result.processed).toBe(0);
  });
});
