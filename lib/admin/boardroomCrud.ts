// CRUD helper for the five boardroom admin route groups that share
// near-identical handler shape: events, meetings, announcements,
// roadmap, feature_requests. Each group is requireAdmin-gated, writes
// via service-role (bypassing RLS), and returns the affected row so
// the admin client can splice into local state without a refetch.
//
// Welcome and stats stay bespoke — they're singletons keyed on cohort
// with PUT-upsert semantics that don't fit this CRUD shape.
//
// Field allow-listing: each handler-factory takes a list of column
// names that the API will accept from the client body. Anything else
// is silently dropped before hitting the database — defense against a
// client trying to set upvote_count, submitted_by, or any field we
// don't intend to expose.

import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";

// SupabaseClient<any> sidesteps the typed-table-lookup problem when
// the table name comes in as a string — without the cast, .insert()
// and .update() argument types narrow to `never`. The boardroom_*
// schema isn't in any generated types file in this repo (Phase 2A
// pattern is to skip the codegen step), so this is the consistent
// shape across all admin write paths.
type ServiceClient = SupabaseClient<any, "public", any>;

function getServiceClient(): { client: ServiceClient | null; error: NextResponse | null } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return {
      client: null,
      error: NextResponse.json({ error: "server_misconfigured" }, { status: 500 }),
    };
  }
  return {
    client: createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as ServiceClient,
    error: null,
  };
}

function pick<T extends Record<string, unknown>>(
  obj: T,
  allowed: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in obj) out[key] = obj[key];
  }
  return out;
}

/** POST /api/admin/boardroom/<table>
 *  Body: { cohort, ...allowedFields }. cohort is required for the
 *  cohort-scoped tables; anything in allowedFields can be set on
 *  insert. Returns the inserted row. */
export function makeBoardroomPost(table: string, allowedFields: readonly string[]) {
  const acceptedKeys = ["cohort", ...allowedFields] as const;

  return async function POST(req: NextRequest) {
    const auth = await requireAdmin(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    if (typeof body.cohort !== "string" || !body.cohort) {
      return NextResponse.json({ error: "cohort_required" }, { status: 400 });
    }

    const insertRow = pick(body, acceptedKeys);

    const { client, error: clientErr } = getServiceClient();
    if (clientErr) return clientErr;

    const { data, error } = await client!
      .from(table)
      .insert(insertRow)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
    }
    return NextResponse.json(data);
  };
}

/** PATCH/DELETE /api/admin/boardroom/<table>/[id] */
export function makeBoardroomRowOps(table: string, allowedFields: readonly string[]) {
  return {
    async PATCH(
      req: NextRequest,
      { params }: { params: Promise<{ id: string }> }
    ) {
      const auth = await requireAdmin(req);
      if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

      const { id } = await params;
      if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return NextResponse.json({ error: "invalid_json" }, { status: 400 });
      }

      const updateRow = pick(body, allowedFields);
      if (Object.keys(updateRow).length === 0) {
        return NextResponse.json({ error: "no_updatable_fields" }, { status: 400 });
      }

      const { client, error: clientErr } = getServiceClient();
      if (clientErr) return clientErr;

      const { data, error } = await client!
        .from(table)
        .update(updateRow)
        .eq("id", id)
        .select("*")
        .single();

      if (error) {
        return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
      }
      if (!data) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      return NextResponse.json(data);
    },

    async DELETE(
      req: NextRequest,
      { params }: { params: Promise<{ id: string }> }
    ) {
      const auth = await requireAdmin(req);
      if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

      const { id } = await params;
      if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

      const { client, error: clientErr } = getServiceClient();
      if (clientErr) return clientErr;

      const { error } = await client!
        .from(table)
        .delete()
        .eq("id", id);

      if (error) {
        return NextResponse.json({ error: "delete_failed", message: error.message }, { status: 500 });
      }
      return NextResponse.json({ id, removed: true });
    },
  };
}
