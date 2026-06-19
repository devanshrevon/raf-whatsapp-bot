import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatDateTime, formatGBP, formatPhone } from "@/lib/format";
import { StatusBadge } from "../../status-badge";
import {
  bookCallbackAction,
  markCompletedAction,
  markMissedAction,
  pauseBotAction,
  resumeBotAction,
  stopMessagesAction
} from "./actions";

export const dynamic = "force-dynamic";

function ActionButton({
  action,
  leadId,
  label,
  variant = "default",
  disabled = false,
  title
}: {
  action?: (leadId: string) => Promise<void>;
  leadId: string;
  label: string;
  variant?: "default" | "danger" | "ghost";
  disabled?: boolean;
  title?: string;
}) {
  const styles =
    variant === "danger"
      ? "border-danger/30 bg-dangerSoft text-danger hover:bg-danger/15"
      : variant === "ghost"
      ? "border-line text-ink/60 hover:bg-paper"
      : "border-line bg-white text-ink hover:bg-paper";

  const className = `focus-ring rounded-md border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${styles}`;

  if (disabled || !action) {
    return (
      <button type="button" disabled title={title} className={className}>
        {label}
      </button>
    );
  }

  return (
    <form action={action.bind(null, leadId)}>
      <button type="submit" title={title} className={className}>
        {label}
      </button>
    </form>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink/50">{label}</dt>
      <dd className="text-sm text-ink">{value ?? "—"}</dd>
    </div>
  );
}

export default async function LeadDetailPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams?: { bookError?: string; booked?: string };
}) {
  const lead = await db.lead.findUnique({
    where: { id: params.id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      appointments: { orderBy: { startAt: "desc" } },
      scheduledActions: { orderBy: { scheduledAt: "desc" } }
    }
  });

  if (!lead) notFound();

  const activeAppointment = lead.appointments.find((a) => a.status === "BOOKED") ?? lead.appointments[0];
  const pendingFollowUps = lead.scheduledActions.filter((a) => a.status === "PENDING");
  const collectedFieldCount = [
    lead.debtTypes.length > 0,
    lead.estimatedDebt != null,
    lead.creditorCount != null,
    lead.monthlyPayment != null,
    lead.region,
    lead.housingStatus,
    lead.employmentStatus,
    lead.dependantSummary,
    lead.motivation
  ].filter(Boolean).length;

  return (
    <div className="px-8 py-6">
      <div className="mb-1 flex items-center gap-3">
        <h1 className="font-display text-xl font-semibold text-ink">
          {lead.preferredName ?? "Unnamed lead"}
        </h1>
        <StatusBadge status={lead.status} />
        {lead.botPaused && (
          <span className="rounded-full bg-warnSoft px-2.5 py-0.5 text-xs font-medium text-warn">
            Bot paused
          </span>
        )}
      </div>
      <p className="mb-6 font-mono text-sm text-ink/60">{formatPhone(lead.phoneNumber)}</p>

      {searchParams?.bookError && (
        <div className="mb-6 rounded-md border border-danger/30 bg-dangerSoft px-4 py-3">
          <p className="text-sm font-medium text-danger">{searchParams.bookError}</p>
        </div>
      )}
      {searchParams?.booked && (
        <div className="mb-6 rounded-md border border-line bg-accentSoft px-4 py-3">
          <p className="text-sm font-medium text-ink">Callback booked.</p>
        </div>
      )}

      {lead.vulnerabilityLevel > 0 && (
        <div className="mb-6 rounded-md border border-danger/30 bg-dangerSoft px-4 py-3">
          <p className="text-sm font-medium text-danger">
            Vulnerability level {lead.vulnerabilityLevel} — handle with approved wording only.
          </p>
          {lead.vulnerabilityFlags.length > 0 && (
            <p className="mt-1 text-xs text-danger/80">{lead.vulnerabilityFlags.join(", ")}</p>
          )}
        </div>
      )}

      <div className="mb-8 flex flex-wrap items-start gap-2">
        {lead.botPaused ? (
          <ActionButton action={resumeBotAction} leadId={lead.id} label="Resume bot" />
        ) : (
          <ActionButton action={pauseBotAction} leadId={lead.id} label="Pause bot" />
        )}
        <form
          action={async (fd: FormData) => {
            "use server";
            await bookCallbackAction(lead.id, fd);
          }}
          className="flex items-center gap-1"
        >
          <input
            type="date"
            name="date"
            required
            className="focus-ring rounded-md border border-line px-2 py-1 text-sm text-ink"
          />
          <input
            type="time"
            name="time"
            required
            className="focus-ring rounded-md border border-line px-2 py-1 text-sm text-ink"
          />
          <button
            type="submit"
            className="focus-ring rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-paper"
          >
            Book / reschedule
          </button>
        </form>
        <ActionButton action={markMissedAction} leadId={lead.id} label="Mark no answer" variant="ghost" />
        <ActionButton action={markCompletedAction} leadId={lead.id} label="Mark completed" />
        <ActionButton action={stopMessagesAction} leadId={lead.id} label="Stop messages" variant="danger" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-lg border border-line bg-white p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-ink">Information collected</h2>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Debt types" value={lead.debtTypes.length ? lead.debtTypes.join(", ") : null} />
            <Field label="Approx. total debt" value={formatGBP(lead.estimatedDebt)} />
            <Field label="Creditors" value={lead.creditorCount} />
            <Field label="Monthly payment" value={formatGBP(lead.monthlyPayment)} />
            <Field label="Region" value={lead.region} />
            <Field label="Housing" value={lead.housingStatus} />
            <Field label="Employment" value={lead.employmentStatus} />
            <Field label="Dependants" value={lead.dependantSummary} />
            <Field label="Reason for seeking help" value={lead.motivation} />
          </dl>

          <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-ink/40">
            Snapshot
          </h3>
          <p className="text-sm text-ink/70">
            {collectedFieldCount === 0
              ? "No details collected yet — the bot will fill this in as it talks to the customer."
              : `${collectedFieldCount} of 9 required fields collected so far.`}
          </p>
        </section>

        <section className="space-y-6">
          <div className="rounded-lg border border-line bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">Appointment</h2>
            {activeAppointment ? (
              <dl className="space-y-3">
                <Field label="Status" value={<StatusBadge status={activeAppointment.status} kind="appointment" />} />
                <Field label="Time" value={formatDateTime(activeAppointment.startAt)} />
                <Field label="Timezone" value={activeAppointment.timezone} />
              </dl>
            ) : (
              <p className="text-sm text-ink/50">No callback booked yet.</p>
            )}
          </div>

          <div className="rounded-lg border border-line bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">Follow-up</h2>
            <p className="mb-2 text-sm text-ink/70">{lead.followUpCount} sent so far</p>
            {pendingFollowUps.length === 0 ? (
              <p className="text-sm text-ink/50">None pending.</p>
            ) : (
              <ul className="space-y-1.5">
                {pendingFollowUps.map((action) => (
                  <li key={action.id} className="text-sm text-ink/70">
                    {action.actionType.replace(/_/g, " ").toLowerCase()} — {formatDateTime(action.scheduledAt)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <section className="mt-6 rounded-lg border border-line bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink">Transcript</h2>
        {lead.messages.length === 0 ? (
          <p className="text-sm text-ink/50">No messages yet.</p>
        ) : (
          <div className="space-y-3">
            {lead.messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-xl rounded-md px-3 py-2 text-sm ${
                  message.direction === "INBOUND"
                    ? "bg-paper text-ink"
                    : "ml-auto bg-accentSoft text-ink"
                }`}
              >
                <p>{message.body}</p>
                <p className="mt-1 text-xs text-ink/40">
                  {message.senderType.toLowerCase()} · {formatDateTime(message.createdAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
