import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getWorkbook } from "@/lib/workbooks/definitions";
import { emptyResponse, parseResponse } from "@/lib/workbooks/responses";

type Context = { params: Promise<{ slug: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(_request: NextRequest, context: Context) {
  const { slug } = await context.params;
  const workbook = getWorkbook(slug);
  if (!workbook) return json({ error: "Workbook not found." }, 404);
  const auth = await getCurrentUser();
  if (!auth.ok) return json({ error: "Sign in to open your personal workbook." }, auth.status);
  const supabase = await createClient();
  const { data, error } = await supabase.from("workbook_responses")
    .select("response, revision, updated_at").eq("user_id", auth.user.id).eq("workbook_slug", slug).maybeSingle();
  if (error) return json({ error: "Your answers could not be loaded. Please try again." }, 503);
  const response = data ? parseResponse(data.response, workbook) : emptyResponse(workbook);
  if (!response) return json({ error: "Your saved workbook needs attention. Please contact support." }, 500);
  return json({ response, revision: data?.revision ?? 0, updatedAt: data?.updated_at ?? null });
}

export async function PUT(request: NextRequest, context: Context) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return json({ error: "Invalid origin." }, 403);
  const { slug } = await context.params;
  const workbook = getWorkbook(slug);
  if (!workbook) return json({ error: "Workbook not found." }, 404);
  const auth = await getCurrentUser();
  if (!auth.ok) return json({ error: "Your session expired. Keep this page open and sign in in another tab, then retry." }, auth.status);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 100000) return json({ error: "Workbook is too large." }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid workbook." }, 400);
  }
  const response = parseResponse(body?.response, workbook);
  const revision = body?.revision;
  if (!response || !Number.isSafeInteger(revision) || revision < 0 || revision >= 2147483647) {
    return json({ error: "Invalid workbook answers or revision." }, 400);
  }
  const supabase = await createClient();
  const row = { response, revision: revision + 1, updated_at: new Date().toISOString() };
  // A compare-and-swap prevents stale tabs/devices from replacing newer answers.
  const result = revision === 0
    ? await supabase.from("workbook_responses").insert({ ...row, user_id: auth.user.id, workbook_slug: slug }).select("revision, updated_at").single()
    : await supabase.from("workbook_responses").update(row).eq("user_id", auth.user.id).eq("workbook_slug", slug).eq("revision", revision).select("revision, updated_at").maybeSingle();
  if (result.error?.code === "23505" || (!result.error && !result.data)) {
    return json({ error: "A newer version was saved in another tab or device. Print or copy your edits, then reload to see the saved version." }, 409);
  }
  if (result.error) return json({ error: "Could not save. Your edits are still on this page. Check your connection and retry before leaving." }, 503);
  return json({ revision: result.data!.revision, updatedAt: result.data!.updated_at });
}
