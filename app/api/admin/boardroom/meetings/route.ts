import { makeBoardroomPost } from "@/lib/admin/boardroomCrud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELDS = [
  "meeting_date", "title", "summary", "video_url",
  "duration_seconds", "tags", "is_published",
] as const;

export const POST = makeBoardroomPost("boardroom_meetings", FIELDS);
