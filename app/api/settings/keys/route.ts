import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  getUserBrokerKeys,
  setUserBrokerKey,
  deleteUserBrokerKey,
  ALLOWED_LABELS,
  type Broker,
} from "@/lib/brokerKeys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isBroker(x: unknown): x is Broker {
  return x === "alpaca" || x === "tradezero";
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const data = await getUserBrokerKeys(auth.user.id);
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: "fetch_failed", message: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { broker?: unknown; values?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isBroker(body.broker)) {
    return NextResponse.json({ error: "invalid_broker" }, { status: 400 });
  }
  const broker = body.broker;

  if (!body.values || typeof body.values !== "object" || Array.isArray(body.values)) {
    return NextResponse.json({ error: "invalid_values" }, { status: 400 });
  }
  const values = body.values as Record<string, unknown>;
  const entries = Object.entries(values);
  if (entries.length === 0) {
    return NextResponse.json({ error: "no_values" }, { status: 400 });
  }

  const allowed = ALLOWED_LABELS[broker];
  for (const [label, value] of entries) {
    if (!allowed.includes(label)) {
      return NextResponse.json({ error: "invalid_label", label }, { status: 400 });
    }
    if (typeof value !== "string" || value.length === 0) {
      return NextResponse.json({ error: "empty_or_invalid_value", label }, { status: 400 });
    }
  }

  try {
    for (const [label, value] of entries) {
      await setUserBrokerKey(auth.user.id, broker, label, value as string);
    }
    const data = await getUserBrokerKeys(auth.user.id);
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: "save_failed", message: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { broker?: unknown; label?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isBroker(body.broker)) {
    return NextResponse.json({ error: "invalid_broker" }, { status: 400 });
  }
  const broker = body.broker;

  const label = typeof body.label === "string" ? body.label : undefined;
  if (label !== undefined && !ALLOWED_LABELS[broker].includes(label)) {
    return NextResponse.json({ error: "invalid_label" }, { status: 400 });
  }

  try {
    await deleteUserBrokerKey(auth.user.id, broker, label);
    const data = await getUserBrokerKeys(auth.user.id);
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: "delete_failed", message: msg }, { status: 500 });
  }
}
