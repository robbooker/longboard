import { makeBoardroomRowOps } from "@/lib/admin/boardroomCrud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELDS = ["title", "body", "is_published"] as const;

const ops = makeBoardroomRowOps("boardroom_feature_requests", FIELDS);
export const PATCH = ops.PATCH;
export const DELETE = ops.DELETE;
