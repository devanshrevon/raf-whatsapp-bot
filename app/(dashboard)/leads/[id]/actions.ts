"use server";

import { revalidatePath } from "next/cache";
import * as mutations from "@/lib/leads/mutations";

async function refresh(leadId: string) {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  revalidatePath("/appointments");
}

export async function pauseBotAction(leadId: string) {
  await mutations.setBotPaused(leadId, true);
  await refresh(leadId);
}

export async function resumeBotAction(leadId: string) {
  await mutations.setBotPaused(leadId, false);
  await refresh(leadId);
}

export async function markCompletedAction(leadId: string) {
  await mutations.markCompleted(leadId);
  await refresh(leadId);
}

export async function markMissedAction(leadId: string) {
  await mutations.markMissed(leadId);
  await refresh(leadId);
}

export async function stopMessagesAction(leadId: string) {
  await mutations.stopMessages(leadId);
  await refresh(leadId);
}
