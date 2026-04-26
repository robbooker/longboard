import { makeBoardroomPost } from "@/lib/admin/boardroomCrud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELDS = ["title", "status", "sort_order", "is_published"] as const;

export const POST = makeBoardroomPost("boardroom_roadmap", FIELDS);
