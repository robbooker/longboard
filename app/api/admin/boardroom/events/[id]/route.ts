import { makeBoardroomRowOps } from "@/lib/admin/boardroomCrud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELDS = ["starts_at", "ends_at", "title", "subtitle", "rsvp_url", "is_published"] as const;

const ops = makeBoardroomRowOps("boardroom_events", FIELDS);
export const PATCH = ops.PATCH;
export const DELETE = ops.DELETE;
