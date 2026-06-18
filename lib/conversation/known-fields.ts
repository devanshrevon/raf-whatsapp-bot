import type { Lead } from "@prisma/client";
import { DATA_FIELDS, isFieldKnown, type DataField } from "@/lib/conversation/fields";

// Work out which required fields (spec §7) are still missing, so the next
// question is always chosen from the missing list — the bot never re-asks
// something it already knows (spec §9, §19.1).

export function missingDataFields(lead: Lead): DataField[] {
  return DATA_FIELDS.filter((field) => !isFieldKnown(lead, field.key));
}

export function knownDataFields(lead: Lead): DataField[] {
  return DATA_FIELDS.filter((field) => isFieldKnown(lead, field.key));
}

/** All collectable details are present (consent is tracked separately). */
export function hasAllDetails(lead: Lead): boolean {
  return missingDataFields(lead).length === 0;
}

/** Ready to actually book: all details collected AND callback consent given. */
export function isReadyForCallback(lead: Lead): boolean {
  return hasAllDetails(lead) && lead.callbackConsent;
}

/** Human-readable summary of what we already know, for the prompt context. */
export function knownFactsSummary(lead: Lead): string {
  const known = knownDataFields(lead);
  if (known.length === 0) return "Nothing yet.";
  return known
    .map((field) => {
      const value = lead[field.key];
      const printed = Array.isArray(value) ? value.join(", ") : String(value);
      return `- ${field.label}: ${printed}`;
    })
    .join("\n");
}
