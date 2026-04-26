import { makeBoardroomRowOps } from "@/lib/admin/boardroomCrud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELDS = [
  "meeting_date", "title", "summary", "video_url",
  "duration_seconds", "tags", "is_published",
] as const;

const ops = makeBoardroomRowOps("boardroom_meetings", FIELDS);
export const PATCH = ops.PATCH;
export const DELETE = ops.DELETE;
