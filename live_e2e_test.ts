import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { db } from "@/lib/db";
import { processInboundMessage } from "@/lib/ai/process-message";
import { handleBookingTurn } from "@/lib/calendar/conversation-booking";
import { bookCallback, rescheduleCallback, cancelCallback, SlotUnavailableError } from "@/lib/calendar/booking";
import { londonParts, londonOffsetMs } from "@/lib/calendar/timezone";
import { updateAppointmentStatus } from "@/lib/appointments/mutations";
import { processDueScheduledActions } from "@/lib/scheduled-actions/process";
import { getAvailableSlots } from "@/lib/calendar/availability";
import { google } from "googleapis";
import { env } from "@/lib/env";

const auth = new google.auth.OAuth2(env.google.clientId, env.google.clientSecret, env.google.redirectUri);
auth.setCredentials({ refresh_token: env.google.refreshToken });
const calendar = google.calendar({ version: "v3", auth });

async function getEvent(eventId: string) {
  const res = await calendar.events.get({ calendarId: env.google.calendarId, eventId });
  return res.data;
}

async function run() {
  console.log("--- STARTING E2E TEST ---");
  const report = { created: { leads: [] as string[], appointments: [] as string[], actions: [] as string[], events: [] as string[] } };

  try {
    // 1. Create test lead
    const testNumber = `+1000000${Math.floor(Math.random() * 9000 + 1000)}`;
    let lead = await db.lead.create({ data: { phoneNumber: testNumber } });
    report.created.leads.push(lead.id);
    console.log(`[TEST DATA] Created Lead: ${lead.id} (${testNumber})`);

    // Jump straight to availability state to test booking directly
    lead = await db.lead.update({
      where: { id: lead.id },
      data: {
        preferredName: "EndToEnd TestUser",
        callbackConsent: true,
        conversationStage: "COLLECT_AVAILABILITY"
      }
    });

    // Pick a date (tomorrow)
    const tomorrow = new Date(Date.now() + 86400000);
    const dateStr = londonParts(tomorrow).dateStr;

    // List events on the test calendar to ensure we don't pick one that overlaps (though getAvailableSlots does this anyway)
    const existingEvents = await calendar.events.list({
        calendarId: env.google.calendarId,
        timeMin: new Date(new Date().setHours(0,0,0,0)).toISOString(),
        timeMax: new Date(new Date().setHours(23,59,59,999) + 86400000 * 7).toISOString(),
    });
    console.log(`\n[PRE-CHECK] Found ${existingEvents.data.items?.length || 0} existing events this week.`);

    // 2. Offer slots
    const slots = await getAvailableSlots({ dateStr });
    if (slots.length === 0) throw new Error("No slots available tomorrow to test with.");
    
    // Pick the first slot
    const slotStart = slots[0];
    const slotEnd = new Date(slotStart.getTime() + 15 * 60000); // 15 min default duration
    console.log(`[BOOKING] Attempting to book slot: ${slotStart.toISOString()}`);

    // Call handleBookingTurn to mimic webhook
    const bookingRes = await handleBookingTurn({
      lead,
      availability: { date: null, earliestTime: null },
      selectedSlotStart: slotStart.toISOString()
    });

    if (!bookingRes.booked) throw new Error("Booking failed in handleBookingTurn");
    console.log("[BOOKING] Confirm reply:", bookingRes.reply);

    // Re-fetch lead and appointment
    lead = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    let appt = await db.appointment.findFirstOrThrow({ where: { leadId: lead.id, status: "BOOKED" } });
    report.created.appointments.push(appt.id);
    report.created.events.push(appt.googleEventId);
    console.log(`[BOOKING] DB Appointment created: ${appt.id}, Google Event ID: ${appt.googleEventId}`);

    // Verify Google Event Timezone and specifics
    let event = await getEvent(appt.googleEventId);
    console.log(`[BOOKING] Google Event fetched: Summary="${event.summary}"`);
    const eventStartUtc = new Date(event.start?.dateTime as string);
    console.log(`[TIMEZONE CHECK] Google Event UTC time: ${eventStartUtc.toISOString()}`);
    console.log(`[TIMEZONE CHECK] DB Appointment UTC time: ${appt.startAt.toISOString()}`);
    const offset = londonOffsetMs(eventStartUtc);
    const expectedLocal = new Date(eventStartUtc.getTime() + offset);
    console.log(`[TIMEZONE CHECK] Event UTC + London Offset (${offset/3600000}h) = ${expectedLocal.toISOString()}`);

    // 3. Rescheduling
    // Pick next available slot after the first
    const newSlotStart = slots[slots.length - 1]; // Pick last slot to ensure diff
    console.log(`\n[RESCHEDULE] Attempting to reschedule to: ${newSlotStart.toISOString()}`);

    // We can directly call rescheduleCallback since the user would trigger this via UI or AI intent
    const rescheduledAppt = await rescheduleCallback(appt.id, newSlotStart);
    console.log(`[RESCHEDULE] Appointment rescheduled.`);

    // Verify old event updated correctly
    event = await getEvent(appt.googleEventId); // Event ID remains the same since we update
    const newEventStartUtc = new Date(event.start?.dateTime as string);
    console.log(`[RESCHEDULE] Updated Google Event UTC time: ${newEventStartUtc.toISOString()}`);
    console.log(`[RESCHEDULE] DB matches updated start: ${rescheduledAppt.startAt.toISOString() === newEventStartUtc.toISOString()}`);
    
    // Check no duplicate BOOKED appointments
    const bookedApptsCount = await db.appointment.count({ where: { leadId: lead.id, status: "BOOKED" } });
    console.log(`[RESCHEDULE] Duplicate check: Total BOOKED appointments for lead: ${bookedApptsCount}`);

    // 4. "Mark No Answer" path
    console.log(`\n[NO ANSWER] Marking appointment ${appt.id} as MISSED`);
    await updateAppointmentStatus(appt.id, "MISSED");
    
    let missedAction = await db.scheduledAction.findFirstOrThrow({ where: { leadId: lead.id, actionType: "MISSED_CALLBACK" } });
    report.created.actions.push(missedAction.id);
    console.log(`[NO ANSWER] ScheduledAction created: ${missedAction.id} (Status: ${missedAction.status})`);

    // Trigger process
    console.log("[NO ANSWER] Triggering processDueScheduledActions()...");
    // Temporarily set scheduledAt to past to ensure it gets picked up
    await db.scheduledAction.update({ where: { id: missedAction.id }, data: { scheduledAt: new Date(Date.now() - 10000) }});
    
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
        if (url.toString().includes('twilio')) {
            console.log(`[NO ANSWER] [MOCK TWILIO] Prevented message to Twilio. Body:`, new URLSearchParams(options?.body as string).get('Body'));
            return new Response(JSON.stringify({ sid: 'SMmock123' }), { status: 201 });
        }
        return originalFetch(url, options);
    };

    const processRes = await processDueScheduledActions();
    console.log(`[NO ANSWER] processDueScheduledActions result:`, processRes);

    // 5. Concurrency / Race Condition Check
    console.log(`\n[CONCURRENCY] Testing race condition on bookCallback...`);
    // Find another slot
    const raceSlot = slots[Math.floor(slots.length / 2)];
    const raceEnd = new Date(raceSlot.getTime() + 15 * 60000);
    // Create event directly via Google API (simulating another user took it right as we clicked book)
    console.log(`[CONCURRENCY] Manually blocking slot ${raceSlot.toISOString()} via Google API...`);
    const conflictEventId = await createCalendarEventDirectly(raceSlot, raceEnd);
    report.created.events.push(conflictEventId);

    try {
        console.log(`[CONCURRENCY] Now attempting to book the blocked slot via bookCallback...`);
        await bookCallback(lead, raceSlot);
        console.log(`[CONCURRENCY] FAILED: Booking succeeded despite slot being blocked!`);
    } catch (e) {
        if (e instanceof SlotUnavailableError) {
            console.log(`[CONCURRENCY] SUCCESS: Caught SlotUnavailableError as expected! Reason: ${e.reason}`);
        } else {
            console.log(`[CONCURRENCY] Unknown error:`, e);
        }
    }

    console.log("\n--- TEST COMPLETE ---");
    console.log("Cleanup Report:", report);
    process.exit(0);
  } catch (e) {
    console.error("Test failed:", e);
    console.log("Cleanup Report:", report);
    process.exit(1);
  }
}

async function createCalendarEventDirectly(start: Date, end: Date) {
    const res = await calendar.events.insert({
      calendarId: env.google.calendarId,
      requestBody: {
        summary: "BLOCKED FOR RACE CONDITION TEST",
        start: { dateTime: start.toISOString(), timeZone: "Europe/London" },
        end: { dateTime: end.toISOString(), timeZone: "Europe/London" },
      },
    });
    return res.data.id!;
}

run();
