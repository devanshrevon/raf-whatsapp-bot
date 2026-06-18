import Link from "next/link";
import { db } from "@/lib/db";
import { formatDateTime, formatPhone } from "@/lib/format";
import { StatusBadge } from "../status-badge";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const leads = await db.lead.findMany({
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: {
      appointments: {
        where: { status: "BOOKED" },
        orderBy: { startAt: "asc" },
        take: 1
      }
    }
  });

  return (
    <div className="px-8 py-6">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="font-display text-xl font-semibold text-ink">Leads</h1>
        <p className="text-sm text-ink/50">{leads.length} shown</p>
      </div>

      {leads.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-4 py-8 text-center text-sm text-ink/50">
          No leads yet. They'll appear here as soon as someone messages the WhatsApp number.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-white/60 text-xs uppercase tracking-wide text-ink/50">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last message</th>
                <th className="px-4 py-3 font-medium">Callback</th>
                <th className="px-4 py-3 font-medium">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-white">
              {leads.map((lead) => {
                const nextAppointment = lead.appointments[0];
                const needsReview = lead.vulnerabilityLevel >= 2 || lead.status === "NEEDS_REVIEW";
                const lastMessageAt = lead.lastCustomerMessageAt ?? lead.lastBotMessageAt ?? lead.createdAt;

                return (
                  <tr key={lead.id} className="hover:bg-paper">
                    <td className="px-4 py-3">
                      <Link href={`/leads/${lead.id}`} className="focus-ring font-medium text-ink hover:text-accent">
                        {lead.preferredName ?? "Unnamed"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink/70">
                      {formatPhone(lead.phoneNumber)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={lead.status} />
                    </td>
                    <td className="px-4 py-3 text-ink/60">{formatDateTime(lastMessageAt)}</td>
                    <td className="px-4 py-3 text-ink/60">
                      {nextAppointment ? formatDateTime(nextAppointment.startAt) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {needsReview ? (
                        <span className="inline-flex items-center rounded-full bg-dangerSoft px-2.5 py-0.5 text-xs font-medium text-danger">
                          Needs review
                        </span>
                      ) : (
                        <span className="text-ink/30">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
