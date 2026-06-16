import { NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { user, hasProfile, supabaseResponse } = await updateSession(request);

  const isApi = request.nextUrl.pathname.startsWith("/api/");
  const unauthorized = !user || !hasProfile;

  if (unauthorized) {
    if (isApi) {
      return new NextResponse(
        JSON.stringify({ error: "unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/command/:path*",
    "/alpaca/:path*",
    "/tradezero/:path*",
    "/workspace",
    "/workspace/:path*",
    "/settings",
    "/settings/:path*",
    "/codex",
    "/codex/:path*",
    "/admin/:path*",
    "/api/alpaca/:path*",
    "/api/tradezero/:path*",
    "/api/polygon/:path*",
    "/api/settings/:path*",
    "/api/codex/:path*",
    "/api/admin/:path*",
  ],
};
