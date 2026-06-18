import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";

// Only these paths require the dashboard login cookie.
// Twilio webhooks, the internal cron endpoint, and /api/health are intentionally
// excluded — they authenticate themselves (signature / shared secret) and must
// remain reachable by external services.
const PROTECTED_PREFIXES = ["/leads", "/appointments", "/dashboard"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  const isProtectedApi =
    (pathname.startsWith("/api/leads") || pathname.startsWith("/api/appointments")) &&
    !pathname.startsWith("/api/twilio") &&
    !pathname.startsWith("/api/internal");

  if (!isProtected && !isProtectedApi) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const valid = await verifySessionToken(token);

  if (valid) {
    return NextResponse.next();
  }

  if (isProtectedApi) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/leads/:path*", "/appointments/:path*", "/dashboard/:path*", "/api/leads/:path*", "/api/appointments/:path*"]
};
