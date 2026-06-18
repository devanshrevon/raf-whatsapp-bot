import type { Lead } from "@prisma/client";
import { env } from "@/lib/env";
import { formatGBP } from "@/lib/format";

// Calendar event title + description for a callback (spec §15). Vulnerability
// information is included only when present, and only at a high level — detailed
// notes belong in the dashboard, not the calendar invite.

export function buildEventSummary(lead: Lead): string {
  return `Debt consultation callback — ${lead.preferredName ?? lead.phoneNumber}`;
}

export function buildEventDescription(lead: Lead): string {
  const dashboardUrl = `${env.appBaseUrl.replace(/\/+$/, "")}/leads/${lead.id}`;
  const lines = [
    `Phone: ${lead.phoneNumber}`,
    `Approximate debt: ${formatGBP(lead.estimatedDebt)}`,
    `Debt types: ${lead.debtTypes.length ? lead.debtTypes.join(", ") : "—"}`,
    `Location: ${lead.region ?? "—"}`,
    `Housing: ${lead.housingStatus ?? "—"}`,
    `Employment: ${lead.employmentStatus ?? "—"}`,
    `Reason for seeking help: ${lead.motivation ?? "—"}`,
    `Dashboard: ${dashboardUrl}`,
  ];

  if (lead.vulnerabilityLevel >= 2) {
    lines.push(
      `⚠ Flagged for review — see dashboard before calling${
        lead.vulnerabilityFlags.length ? ` (${lead.vulnerabilityFlags.join(", ")})` : ""
      }.`
    );
  }

  return lines.join("\n");
}
