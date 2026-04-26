import { makeBoardroomPost } from "@/lib/admin/boardroomCrud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELDS = ["title", "body", "kind", "posted_at", "is_published"] as const;

export const POST = makeBoardroomPost("boardroom_announcements", FIELDS);
