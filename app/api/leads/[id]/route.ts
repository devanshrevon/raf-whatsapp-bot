import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leadActionSchema } from "@/lib/leads/schema";
import * as mutations from "@/lib/leads/mutations";

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const lead = await db.lead.findUnique({
    where: { id: params.id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      appointments: { orderBy: { startAt: "desc" } },
      scheduledActions: { orderBy: { scheduledAt: "desc" } }
    }
  });

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  return NextResponse.json({ lead });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  const parsed = leadActionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action", details: parsed.error.flatten() }, { status: 400 });
  }

  const lead = await db.lead.findUnique({ where: { id: params.id } });
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  switch (parsed.data.action) {
    case "pause":
      await mutations.setBotPaused(lead.id, true);
      break;
    case "resume":
      await mutations.setBotPaused(lead.id, false);
      break;
    case "markCompleted":
      await mutations.markCompleted(lead.id);
      break;
    case "markMissed":
      await mutations.markMissed(lead.id);
      break;
    case "stop":
      await mutations.stopMessages(lead.id);
      break;
  }

  const updated = await db.lead.findUnique({ where: { id: lead.id } });
  return NextResponse.json({ lead: updated });
}
