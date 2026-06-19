import Link from "next/link";
import { db } from "@/lib/db";
import { formatDateTime, formatPhone, londonDateKey } from "@/lib/format";
import { StatusBadge } from "../status-badge";

export const dynamic = "force-dynamic";

function Section({
  title,
  empty,
  children
}: {
  title: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      {children.length === 0 ? (
        <p className="text-sm text-ink/50">{empty}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-white">
          <ul className="divide-y divide-line">{children}</ul>
        </div>
      )}
    </section>
  );
}

function Row({
  leadId,
  name,
  phone,
  startAt,
  status
}: {
  leadId: string;
  name: string;
  phone: string;
  startAt: Date;
  status: string;
}) {
  return (
    <li className="hover:bg-paper">
      {/* The whole row is the link, so clicking anywhere opens the lead. */}
      <Link
        href={`/leads/${leadId}`}
        className="focus-ring flex items-center justify-between px-4 py-3 text-sm"
      >
        <span className="font-medium text-ink">{name}</span>
        <span className="font-mono text-xs text-ink/50">{formatPhone(phone)}</span>
        <span className="text-ink/60">{formatDateTime(startAt)}</span>
        <StatusBadge status={status} kind="appointment" />
      </Link>
    </li>
  );
}

export default async function AppointmentsPage() {
  const appointments = await db.appointment.findMany({
    orderBy: { startAt: "desc" },
    take: 300,
    include: { lead: { select: { id: true, preferredName: true, phoneNumber: true } } }
  });

  const todayKey = londonDateKey(new Date());
  const now = new Date();

  const today = appointments.filter((a) => a.status === "BOOKED" && londonDateKey(a.startAt) === todayKey);
  const upcoming = appointments.filter(
    (a) => a.status === "BOOKED" && londonDateKey(a.startAt) !== todayKey && a.startAt > now
  );
  const missed = appointments.filter((a) => a.status === "MISSED");
  const completed = appointments.filter((a) => a.status === "COMPLETED");

  const toRows = (list: typeof appointments) =>
    list.map((a) => (
      <Row
        key={a.id}
        leadId={a.lead.id}
        name={a.lead.preferredName ?? "Unnamed"}
        phone={a.lead.phoneNumber}
        startAt={a.startAt}
        status={a.status}
      />
    ));

  return (
    <div className="space-y-8 px-8 py-6">
      <h1 className="font-display text-xl font-semibold text-ink">Appointments</h1>
      <Section title="Today" empty="No callbacks scheduled for today.">
        {toRows(today)}
      </Section>
      <Section title="Upcoming" empty="Nothing booked beyond today yet.">
        {toRows(upcoming)}
      </Section>
      <Section title="Missed" empty="No missed callbacks.">
        {toRows(missed)}
      </Section>
      <Section title="Completed" empty="No completed callbacks yet.">
        {toRows(completed)}
      </Section>
    </div>
  );
}
