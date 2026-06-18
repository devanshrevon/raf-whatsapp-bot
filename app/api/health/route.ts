import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    appVersion: env.appVersion,
    time: new Date().toISOString()
  });
}
