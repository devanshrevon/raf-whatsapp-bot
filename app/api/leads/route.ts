import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const querySchema = z.object({
  status: z
    .enum(["ACTIVE", "BOOKED", "MISSED", "NEEDS_REVIEW", "COMPLETED", "STOPPED"])
    .optional()
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    status: request.nextUrl.searchParams.get("status") ?? undefined
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }

  const leads = await db.lead.findMany({
    where: parsed.data.status ? { status: parsed.data.status } : undefined,
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: {
      appointments: { where: { status: "BOOKED" }, orderBy: { startAt: "asc" }, take: 1 }
    }
  });

  return NextResponse.json({ leads });
}
