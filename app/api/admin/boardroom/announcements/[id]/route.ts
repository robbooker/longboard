import { makeBoardroomRowOps } from "@/lib/admin/boardroomCrud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELDS = ["title", "body", "kind", "posted_at", "is_published"] as const;

const ops = makeBoardroomRowOps("boardroom_announcements", FIELDS);
export const PATCH = ops.PATCH;
export const DELETE = ops.DELETE;
