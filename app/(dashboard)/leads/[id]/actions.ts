"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as mutations from "@/lib/leads/mutations";
import { db } from "@/lib/db";
import { SlotUnavailableError } from "@/lib/calendar/booking";

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

export async function bookCallbackAction(
  leadId: string,
  formData: FormData
): Promise<void> {
  const date = (formData.get("date") as string | null) ?? "";
  const time = (formData.get("time") as string | null) ?? "";
  if (!date || !time) {
    redirect(`/leads/${leadId}?bookError=${encodeURIComponent("Please pick a date and time.")}`);
  }

  // Booking can fail for legitimate reasons (slot in the past, outside calling
  // hours, already busy) or because the calendar is unreachable. Handle it here
  // so the dashboard shows a clear message instead of crashing with a 500.
  let errorMessage: string | null = null;
  try {
    await mutations.bookOrRescheduleCallback(leadId, date, time);
  } catch (err) {
    errorMessage =
      err instanceof SlotUnavailableError
        ? "That time isn't available — it may be in the past, outside calling hours (9am–6pm UK), or already booked. Please try another time."
        : "Couldn't book the callback — the calendar may be temporarily unavailable. Please try again.";
    await db.systemEvent
      .create({
        data: {
          leadId,
          eventType: "external_api_failure",
          detail: {
            where: "dashboard_booking",
            message: err instanceof Error ? err.message : String(err),
          },
        },
      })
      .catch(() => {});
  }

  await refresh(leadId);
  // redirect() throws internally, so it must run outside the try/catch above.
  redirect(
    `/leads/${leadId}?${errorMessage ? `bookError=${encodeURIComponent(errorMessage)}` : "booked=1"}`
  );
}
