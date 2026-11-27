import type { NextRequest } from "next/server";
import { pagesJson, readBody, requirePagesMember, type PagesViewer } from "@/lib/chatPagesServer";
import { CHANNEL_ID, parseChannelRef } from "@/lib/videoPicksFeed";
import {
  forgetPicksAnswer,
  MAX_CHANNEL_TOPICS,
  MAX_CHANNELS,
  readChannels,
  readCollection,
  readTopics,
  resolveChannel,
  VIDEO_PICKS_SLUG,
} from "@/lib/videoPicksServer";
export const dynamic = "force-dynamic";

// #529 Booker Tube: the channel list, for admins only. Add a channel by its UC… id, its
// youtube.com/channel/UC… address or its @handle; it is saved only once its public feed has
// answered. Removing a channel takes its videos off the page at once.

const UNAVAILABLE = "The channel list is unavailable. Please try again.";

async function requireAdmin(
  req: NextRequest,
  write: boolean,
): Promise<{ ok: true; viewer: PagesViewer } | { ok: false; response: Response }> {
  const gate = await requirePagesMember(req, write);
  if (!gate.ok) return gate;
  if (!gate.viewer.isAdmin)
    return { ok: false, response: pagesJson({ error: "Only admins can change the channels." }, 403) };
  return gate;
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req, false);
  if (!gate.ok) return gate.response;
  try {
    const collection = await readCollection(gate.viewer.admin, VIDEO_PICKS_SLUG);
    if (!collection) return pagesJson({ error: UNAVAILABLE }, 404);
    const channels = await readChannels(gate.viewer.admin, collection.id);
    return pagesJson({
      channels: channels.map(({ channelId, name, area, topics }) => ({ channelId, name, area, topics })),
      lastRefresh: collection.refreshStats
        ? {
            videos: collection.refreshStats.videos,
            succeeded: collection.refreshStats.succeeded,
            channels: collection.refreshStats.channels,
            failed: (collection.refreshStats.failed ?? []).map(({ name, error }) => ({ name, error })),
          }
        : null,
    });
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, true);
  if (!gate.ok) return gate.response;
  const { admin, memberId } = gate.viewer;
  const body = await readBody(req);
  const ref = parseChannelRef(body?.channel);
  if (!ref)
    return pagesJson(
      { error: "Paste a channel id (it starts with UC), a youtube.com/channel/UC… address, or an @handle." },
      400,
    );
  try {
    const collection = await readCollection(admin, VIDEO_PICKS_SLUG);
    if (!collection) return pagesJson({ error: UNAVAILABLE }, 404);
    if (typeof body?.area !== "string" || !collection.areas.some((area) => area.id === body.area))
      return pagesJson({ error: "Choose an area for the channel." }, 400);
    const wanted = body.topics === undefined ? [] : body.topics;
    if (
      !Array.isArray(wanted) ||
      wanted.length > MAX_CHANNEL_TOPICS ||
      wanted.some((topic) => typeof topic !== "string") ||
      new Set(wanted).size !== wanted.length
    )
      return pagesJson({ error: `Choose up to ${MAX_CHANNEL_TOPICS} topics.` }, 400);
    const [topics, channels] = await Promise.all([
      readTopics(admin, collection.id),
      readChannels(admin, collection.id),
    ]);
    if (
      (wanted as string[]).some((id) => !topics.some((topic) => topic.id === id && topic.area === body.area))
    )
      return pagesJson({ error: "Choose topics from the channel's area." }, 400);
    if (ref.kind === "id" && channels.some((channel) => channel.channelId === ref.channelId))
      return pagesJson({ error: "That channel is already on the list." }, 409);
    if (channels.length >= MAX_CHANNELS)
      return pagesJson({ error: `The list is full (${MAX_CHANNELS} channels). Remove one first.` }, 400);
    // Nothing is saved until YouTube's public feed for the channel has answered.
    const resolved = await resolveChannel(ref);
    if (!resolved.ok) return pagesJson({ error: resolved.error }, 400);
    if (channels.some((channel) => channel.channelId === resolved.channelId))
      return pagesJson({ error: "That channel is already on the list." }, 409);
    const channel = {
      channelId: resolved.channelId,
      name: resolved.name,
      area: body.area,
      topics: wanted as string[],
    };
    const { error } = await admin.from("chat_video_channels").insert({
      collection_id: collection.id,
      channel_id: channel.channelId,
      name: channel.name,
      area: channel.area,
      topics: channel.topics,
      added_by: memberId,
    });
    if (error)
      return pagesJson(
        { error: String(error.code) === "23505" ? "That channel is already on the list." : UNAVAILABLE },
        String(error.code) === "23505" ? 409 : 503,
      );
    return pagesJson({ channel }, 201);
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin(req, true);
  if (!gate.ok) return gate.response;
  const { admin } = gate.viewer;
  const channelId = req.nextUrl.searchParams.get("id") ?? "";
  if (!CHANNEL_ID.test(channelId)) return pagesJson({ error: "That isn't a channel id." }, 400);
  try {
    const collection = await readCollection(admin, VIDEO_PICKS_SLUG);
    if (!collection) return pagesJson({ error: UNAVAILABLE }, 404);
    const removed = await admin
      .from("chat_video_channels")
      .delete()
      .eq("collection_id", collection.id)
      .eq("channel_id", channelId)
      .select("channel_id");
    if (removed.error) return pagesJson({ error: UNAVAILABLE }, 503);
    if (!removed.data?.length) return pagesJson({ error: "That channel isn't on the list." }, 404);
    const videos = await admin
      .from("chat_video_picks")
      .delete()
      .eq("collection_id", collection.id)
      .eq("channel_id", channelId);
    forgetPicksAnswer(VIDEO_PICKS_SLUG);
    // The channel is gone either way; if its videos couldn't be cleared, the next refresh clears them.
    return pagesJson({ removed: true, videosCleared: !videos.error });
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}
