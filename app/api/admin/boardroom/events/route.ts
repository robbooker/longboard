import { makeBoardroomPost } from "@/lib/admin/boardroomCrud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELDS = ["starts_at", "ends_at", "title", "subtitle", "rsvp_url", "is_published"] as const;

export const POST = makeBoardroomPost("boardroom_events", FIELDS);
