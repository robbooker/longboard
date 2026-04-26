import { makeBoardroomPost } from "@/lib/admin/boardroomCrud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin can seed/edit title + body + publish state. upvote_count and
// submitted_by are intentionally NOT in the allow-list — admins
// shouldn't manually fudge votes or rewrite attribution. Members'
// own POST path lands in Commit 6 with member-context RLS gating.
const FIELDS = ["title", "body", "is_published"] as const;

export const POST = makeBoardroomPost("boardroom_feature_requests", FIELDS);
