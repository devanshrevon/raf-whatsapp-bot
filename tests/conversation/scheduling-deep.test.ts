import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeLead } from "../helpers/lead";

// ── mocks ─────────────────────────────────────────────────────────────────
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

import { db } from "@/lib/db";
import { sendWhatsAppMessage } from "@/lib/twilio/send-message";

// Helper types
type MockFn = ReturnType<typeof vi.fn>;
const mockFindMany = () => db.scheduledAction.findMany as MockFn;
const mockFindUnique = () => db.scheduledAction.findUnique as MockFn;
const mockUpdateMany = () => db.scheduledAction.updateMany as MockFn;
const mockUpdate = () => db.scheduledAction.update as MockFn;
const mockLeadFindUnique = () => db.lead.findUnique as MockFn;
const mockLeadUpdate = () => db.lead.update as MockFn;
const mockApptFindFirst = () => db.appointment.findFirst as MockFn;
const mockSystemEvent = () => db.systemEvent.create as MockFn;
const mockSend = () => sendWhatsAppMessage as MockFn;

// Factory for a minimal scheduled action object
function makeAction(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: "sa_1",
    leadId: "lead_1",
    actionType: "INCOMPLETE_CONVERSATION" as const,
    scheduledAt: new Date(now.getTime() - 10_000), // 10 seconds ago = due
    status: "PENDING" as const,
    attemptCount: 0,
    lastError: null,
    createdAt: new Date(now.getTime() - 86400_000),
    completedAt: null,
    ...overrides,
  };
}

function setupSuccessfulSend(action: ReturnType<typeof makeAction>) {
  mockFindMany().mockResolvedValue([action]);
  mockUpdateMany().mockResolvedValue({ count: 1 });
  mockLeadFindUnique().mockResolvedValue(makeLead({ id: action.leadId }));
  mockApptFindFirst().mockResolvedValue(null);
  mockLeadUpdate().mockResolvedValue({});
  mockSystemEvent().mockResolvedValue({});
  mockUpdate().mockResolvedValue({ ...action, status: "COMPLETED" });
}

beforeEach(() => {
  // resetAllMocks clears call history AND implementations, so a rejection set
  // in one test (e.g. "fatal error") can't leak into the next.
  vi.resetAllMocks();
  // Re-establish the happy-path send default that resetAllMocks just cleared.
  (sendWhatsAppMessage as MockFn).mockResolvedValue({ id: "msg_ok" });

  // Stateful scheduledAction.findUnique: the processor re-reads the action after
  // processing to count the outcome, so findUnique must reflect the status set by
  // the most recent update() on that id (default PROCESSING before any update).
  // The action's other fields come from whatever findMany was seeded with.
  mockFindUnique().mockImplementation(async (args: { where: { id: string } }) => {
    const id = args?.where?.id;
    const updateCalls = (db.scheduledAction.update as MockFn).mock.calls.filter(
      (c) => c[0]?.where?.id === id
    );
    const status = updateCalls.length
      ? updateCalls[updateCalls.length - 1][0]?.data?.status
      : "PROCESSING";

    let shape: Record<string, unknown> = {
      id,
      leadId: "lead_1",
      actionType: "INCOMPLETE_CONVERSATION",
      attemptCount: 0,
      lastError: null,
      createdAt: new Date(Date.now() - 86_400_000),
      scheduledAt: new Date(),
      completedAt: null,
    };
    const fmResults = (db.scheduledAction.findMany as MockFn).mock.results;
    if (fmResults.length) {
      const arr = await fmResults[0].value;
      const found = Array.isArray(arr) ? arr.find((a) => a.id === id) : null;
      if (found) shape = { ...found };
    }
    return { ...shape, status };
  });
});

// ── retry / backoff ──────────────────────────────────────────────────────────

describe("retry logic — Twilio send failure", () => {
  it("reschedules with 5-minute backoff on first failure (attemptCount=0)", async () => {
    const action = makeAction({ attemptCount: 0 });
    mockFindMany().mockResolvedValue([action]);
    mockUpdateMany().mockResolvedValue({ count: 1 });
    mockLeadFindUnique().mockResolvedValue(makeLead({ id: action.leadId }));
    mockApptFindFirst().mockResolvedValue(null);
    mockSystemEvent().mockResolvedValue({});
    mockLeadUpdate().mockResolvedValue({});

    // Twilio fails on send
    mockSend().mockRejectedValue(new Error("Twilio 503"));
    // update is called twice: once by failOrRetry, once to read final status
    mockUpdate().mockResolvedValue({ ...action, status: "PENDING", attemptCount: 1 });

    const { processDueScheduledActions } = await import(
      "@/lib/scheduled-actions/process"
    );
    await processDueScheduledActions();

    // scheduledAction.update should be called with status PENDING and a future scheduledAt
    const updateCall = (db.scheduledAction.update as MockFn).mock.calls.find(
      (c) => c[0]?.data?.status === "PENDING"
    );
    expect(updateCall).toBeDefined();
    const scheduledAt: Date = updateCall?.[0]?.data?.scheduledAt;
    expect(scheduledAt instanceof Date).toBe(true);
    // Should be ~5 minutes in the future (within 10 seconds tolerance)
    const diffMs = scheduledAt.getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(4 * 60_000); // > 4 min
    expect(diffMs).toBeLessThan(6 * 60_000); // < 6 min
  });

  it("reschedules with 15-minute backoff on second failure (attemptCount=1)", async () => {
    const action = makeAction({ attemptCount: 1 });
    mockFindMany().mockResolvedValue([action]);
    mockUpdateMany().mockResolvedValue({ count: 1 });
    mockLeadFindUnique().mockResolvedValue(makeLead({ id: action.leadId }));
    mockApptFindFirst().mockResolvedValue(null);
    mockSystemEvent().mockResolvedValue({});
    mockLeadUpdate().mockResolvedValue({});
    mockSend().mockRejectedValue(new Error("Twilio 503"));
    mockUpdate().mockResolvedValue({ ...action, status: "PENDING", attemptCount: 2 });

    const { processDueScheduledActions } = await import(
      "@/lib/scheduled-actions/process"
    );
    await processDueScheduledActions();

    const updateCall = (db.scheduledAction.update as MockFn).mock.calls.find(
      (c) => c[0]?.data?.status === "PENDING"
    );
    expect(updateCall).toBeDefined();
    const scheduledAt: Date = updateCall?.[0]?.data?.scheduledAt;
    const diffMs = scheduledAt.getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(14 * 60_000); // > 14 min
    expect(diffMs).toBeLessThan(16 * 60_000); // < 16 min
  });

  it("sets status=FAILED after 3 failures (attemptCount=2 → 3 >= MAX_ATTEMPTS)", async () => {
    const action = makeAction({ attemptCount: 2 });
    mockFindMany().mockResolvedValue([action]);
    mockUpdateMany().mockResolvedValue({ count: 1 });
    mockLeadFindUnique().mockResolvedValue(makeLead({ id: action.leadId }));
    mockApptFindFirst().mockResolvedValue(null);
    mockSystemEvent().mockResolvedValue({});
    mockLeadUpdate().mockResolvedValue({});
    mockSend().mockRejectedValue(new Error("Twilio 503"));
    mockUpdate().mockResolvedValue({ ...action, status: "FAILED", attemptCount: 3 });

    const { processDueScheduledActions } = await import(
      "@/lib/scheduled-actions/process"
    );
    await processDueScheduledActions();

    const failCall = (db.scheduledAction.update as MockFn).mock.calls.find(
      (c) => c[0]?.data?.status === "FAILED"
    );
    expect(failCall).toBeDefined();
    expect(failCall?.[0]?.data?.attemptCount).toBe(3);
    // FAILED actions must have a completedAt
    expect(failCall?.[0]?.data?.completedAt).toBeTruthy();
  });

  it("does NOT retry after FAILED — result.failed is 1", async () => {
    const action = makeAction({ attemptCount: 2 });
    mockFindMany().mockResolvedValue([action]);
    mockUpdateMany().mockResolvedValue({ count: 1 });
    mockLeadFindUnique().mockResolvedValue(makeLead({ id: action.leadId }));
    mockApptFindFirst().mockResolvedValue(null);
    mockSystemEvent().mockResolvedValue({});
    mockLeadUpdate().mockResolvedValue({});
    mockSend().mockRejectedValue(new Error("fatal error"));
    mockUpdate().mockResolvedValue({ ...action, status: "FAILED" });

    const { processDueScheduledActions } = await import(
      "@/lib/scheduled-actions/process"
    );
    const result = await processDueScheduledActions();
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(0);
  });
});

// ── future action is NOT processed ──────────────────────────────────────────

describe("scheduling time gating", () => {
  it("returns early with zero processed when no actions are due", async () => {
    // findMany returns empty → nothing to process
    mockFindMany().mockResolvedValue([]);
    const { processDueScheduledActions } = await import(
      "@/lib/scheduled-actions/process"
    );
    const result = await processDueScheduledActions();
    expect(result.processed).toBe(0);
    expect(result.cancelled).toBe(0);
    expect(result.failed).toBe(0);
    expect(db.scheduledAction.updateMany).not.toHaveBeenCalled();
  });

  it("findMany is called with scheduledAt lte filter", async () => {
    mockFindMany().mockResolvedValue([]);
    const { processDueScheduledActions } = await import(
      "@/lib/scheduled-actions/process"
    );
    await processDueScheduledActions();
    expect(db.scheduledAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scheduledAt: expect.objectContaining({ lte: expect.any(Date) }),
        }),
      })
    );
  });
});

// ── guard-based cancellation ─────────────────────────────────────────────────

describe("guard cancellation — opted-out lead", () => {
  it("cancels (not fails) the action when lead.optedOut=true", async () => {
    const action = makeAction();
    mockFindMany().mockResolvedValue([action]);
    mockUpdateMany().mockResolvedValue({ count: 1 });
    mockLeadFindUnique().mockResolvedValue(
      makeLead({ id: action.leadId, optedOut: true })
    );
    mockUpdate().mockResolvedValue({ ...action, status: "CANCELLED" });

    const { processDueScheduledActions } = await import(
      "@/lib/scheduled-actions/process"
    );
    const result = await processDueScheduledActions();

    expect(result.cancelled).toBe(1);
    // sendWhatsAppMessage must NOT have been called
    expect(mockSend()).not.toHaveBeenCalled();
    // action.update must have been called with status=CANCELLED
    const cancelCall = (db.scheduledAction.update as MockFn).mock.calls.find(
      (c) => c[0]?.data?.status === "CANCELLED"
    );
    expect(cancelCall).toBeDefined();
    expect(cancelCall?.[0]?.data?.lastError).toBe("opted_out");
  });
});

describe("guard cancellation — bot paused", () => {
  it("cancels the action when lead.botPaused=true", async () => {
    const action = makeAction();
    mockFindMany().mockResolvedValue([action]);
    mockUpdateMany().mockResolvedValue({ count: 1 });
    mockLeadFindUnique().mockResolvedValue(
      makeLead({ id: action.leadId, botPaused: true })
    );
    mockUpdate().mockResolvedValue({ ...action, status: "CANCELLED" });

    const { processDueScheduledActions } = await import(
      "@/lib/scheduled-actions/process"
    );
    const result = await processDueScheduledActions();

    expect(result.cancelled).toBe(1);
    expect(mockSend()).not.toHaveBeenCalled();
  });
});

describe("guard cancellation — lead completed/stopped", () => {
  it("cancels the action when lead.status=COMPLETED", async () => {
    const action = makeAction();
    mockFindMany().mockResolvedValue([action]);
    mockUpdateMany().mockResolvedValue({ count: 1 });
    mockLeadFindUnique().mockResolvedValue(
      makeLead({ id: action.leadId, status: "COMPLETED" })
    );
    mockUpdate().mockResolvedValue({ ...action, status: "CANCELLED" });

    const { processDueScheduledActions } = await import(
      "@/lib/scheduled-actions/process"
    );
    const result = await processDueScheduledActions();

    expect(result.cancelled).toBe(1);
    expect(mockSend()).not.toHaveBeenCalled();
  });

  it("cancels the action when lead.status=STOPPED", async () => {
    const action = makeAction();
    mockFindMany().mockResolvedValue([action]);
    mockUpdateMany().mockResolvedValue({ count: 1 });
    mockLeadFindUnique().mockResolvedValue(
      makeLead({ id: action.leadId, status: "STOPPED" })
    );
    mockUpdate().mockResolvedValue({ ...action, status: "CANCELLED" });

    const { processDueScheduledActions } = await import(
      "@/lib/scheduled-actions/process"
    );
    const result = await processDueScheduledActions();

    expect(result.cancelled).toBe(1);
    expect(mockSend()).not.toHaveBeenCalled();
  });
});

describe("guard cancellation — customer replied", () => {
  it("cancels INCOMPLETE_CONVERSATION when customer replied after action was created", async () => {
    const createdAt = new Date("2026-06-18T10:00:00Z");
    const replyAt = new Date("2026-06-18T11:00:00Z"); // after createdAt
    const action = makeAction({
      actionType: "INCOMPLETE_CONVERSATION",
      createdAt,
    });
    mockFindMany().mockResolvedValue([action]);
    mockUpdateMany().mockResolvedValue({ count: 1 });
    mockLeadFindUnique().mockResolvedValue(
      makeLead({ id: action.leadId, lastCustomerMessageAt: replyAt })
    );
    mockUpdate().mockResolvedValue({ ...action, status: "CANCELLED" });

    const { processDueScheduledActions } = await import(
      "@/lib/scheduled-actions/process"
    );
    const result = await processDueScheduledActions();

    expect(result.cancelled).toBe(1);
    expect(mockSend()).not.toHaveBeenCalled();
  });

  it("sends INCOMPLETE_CONVERSATION when customer replied BEFORE action was created", async () => {
    const createdAt = new Date("2026-06-18T10:00:00Z");
    const replyAt = new Date("2026-06-18T09:00:00Z"); // before createdAt
    const action = makeAction({
      actionType: "INCOMPLETE_CONVERSATION",
      createdAt,
    });
    setupSuccessfulSend(action);
    mockLeadFindUnique().mockResolvedValue(
      makeLead({ id: action.leadId, lastCustomerMessageAt: replyAt })
    );

    const { processDueScheduledActions } = await import(
      "@/lib/scheduled-actions/process"
    );
    const result = await processDueScheduledActions();

    expect(mockSend()).toHaveBeenCalledOnce();
    expect(result.processed).toBe(1);
  });
});

// ── successful send ───────────────────────────────────────────────────────────

describe("successful action processing", () => {
  it("marks action COMPLETED and increments followUpCount", async () => {
    const action = makeAction();
    setupSuccessfulSend(action);

    const { processDueScheduledActions } = await import(
      "@/lib/scheduled-actions/process"
    );
    const result = await processDueScheduledActions();

    expect(mockSend()).toHaveBeenCalledOnce();
    expect(result.processed).toBe(1);

    // lead.update should have been called to increment followUpCount
    const leadUpdateCall = (db.lead.update as MockFn).mock.calls.find(
      (c) => c[0]?.data?.followUpCount !== undefined
    );
    expect(leadUpdateCall).toBeDefined();
  });

  it("creates a system_events row on success", async () => {
    const action = makeAction();
    setupSuccessfulSend(action);

    const { processDueScheduledActions } = await import(
      "@/lib/scheduled-actions/process"
    );
    await processDueScheduledActions();

    expect(db.systemEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: "follow_up_sent" }),
      })
    );
  });
});

// ── deleted lead ──────────────────────────────────────────────────────────────

describe("deleted lead handling", () => {
  it("cancels the action gracefully when the lead no longer exists in DB", async () => {
    const action = makeAction();
    mockFindMany().mockResolvedValue([action]);
    mockUpdateMany().mockResolvedValue({ count: 1 });
    // lead has been deleted
    mockLeadFindUnique().mockResolvedValue(null);
    mockUpdate().mockResolvedValue({ ...action, status: "CANCELLED" });

    const { processDueScheduledActions } = await import(
      "@/lib/scheduled-actions/process"
    );
    // Must NOT throw
    const result = await processDueScheduledActions();
    expect(mockSend()).not.toHaveBeenCalled();
    // The action should be cancelled (not errored)
    const cancelCall = (db.scheduledAction.update as MockFn).mock.calls.find(
      (c) => c[0]?.data?.status === "CANCELLED"
    );
    expect(cancelCall).toBeDefined();
  });
});

// ── scheduling helpers ────────────────────────────────────────────────────────

describe("scheduleIncompleteConversationFollowUp", () => {
  beforeEach(() => {
    (db.scheduledAction.updateMany as MockFn).mockResolvedValue({ count: 0 });
    (db.scheduledAction.create as MockFn).mockResolvedValue({ id: "sa_new" });
  });

  it("cancels existing PENDING INCOMPLETE_CONVERSATION actions before creating a new one", async () => {
    const { scheduleIncompleteConversationFollowUp } = await import(
      "@/lib/scheduled-actions/process"
    );
    await scheduleIncompleteConversationFollowUp("lead_1");

    expect(db.scheduledAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          leadId: "lead_1",
          actionType: "INCOMPLETE_CONVERSATION",
          status: "PENDING",
        }),
        data: { status: "CANCELLED" },
      })
    );
  });

  it("creates a new PENDING action with the correct type", async () => {
    const { scheduleIncompleteConversationFollowUp } = await import(
      "@/lib/scheduled-actions/process"
    );
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

  it("schedules the action in the future (not in the past)", async () => {
    const { scheduleIncompleteConversationFollowUp } = await import(
      "@/lib/scheduled-actions/process"
    );
    await scheduleIncompleteConversationFollowUp("lead_1");

    const createCall = (db.scheduledAction.create as MockFn).mock.calls[0];
    const scheduledAt: Date = createCall?.[0]?.data?.scheduledAt;
    expect(scheduledAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("cancelPendingFollowUps", () => {
  it("cancels all PENDING actions for the given lead", async () => {
    (db.scheduledAction.updateMany as MockFn).mockResolvedValue({ count: 3 });
    const { cancelPendingFollowUps } = await import(
      "@/lib/scheduled-actions/process"
    );
    await cancelPendingFollowUps("lead_xyz");

    expect(db.scheduledAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ leadId: "lead_xyz", status: "PENDING" }),
        data: { status: "CANCELLED" },
      })
    );
  });
});
