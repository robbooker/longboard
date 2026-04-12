import { NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

function isAllowedEmail(email: string | undefined): boolean {
  if (!email) return false;
  const allowed = process.env.ALLOWED_EMAILS;
  if (!allowed) return false;
  const list = allowed.split(",").map((e) => e.trim().toLowerCase());
  return list.includes(email.toLowerCase());
}

export async function middleware(request: NextRequest) {
  const { user, supabaseResponse } = await updateSession(request);

  const isApi = request.nextUrl.pathname.startsWith("/api/");
  const unauthorized = !user || !isAllowedEmail(user.email);

  if (unauthorized) {
    if (isApi) {
      return new NextResponse(
        JSON.stringify({ error: "unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/alpaca/:path*",
    "/tradezero/:path*",
    "/api/alpaca/:path*",
    "/api/tradezero/:path*",
    "/api/polygon/:path*",
  ],
};
