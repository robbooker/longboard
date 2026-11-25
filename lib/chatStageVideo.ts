// #502 Stage mode's live video: the pieces that need no LiveKit library (settings, names, the
// "is this room live" memory and who may do what). The LiveKit calls themselves are in
// lib/chatStageLiveKit.ts, behind the small StageVideoApi below so tests can stand in for LiveKit.
//
// Nothing is stored in the database: LiveKit is the record. A room has been "started" while an RTMP
// ingress exists for its LiveKit room, and it is "live" while that ingress is publishing.
// Never log an API key, secret, viewer token or stream key from here or from the routes.
import { parseChatRoom, type ChatRoom } from "./publicChat";
import type { StageState } from "./chatStageLive";

export type StageVideoConfig = { url: string; apiKey: string; apiSecret: string };

/**
 * The three server-only settings. Any one missing (or CHAT_STAGE_MODE=off) and live video is off
 * everywhere: no status checks, no badge, no token, and the stage is the admin preview as before.
 */
export function stageVideoConfig(env: Record<string, string | undefined> = process.env): StageVideoConfig | null {
  const url = env.LIVEKIT_URL?.trim();
  const apiKey = env.LIVEKIT_API_KEY?.trim();
  const apiSecret = env.LIVEKIT_API_SECRET?.trim();
  if (!url || !apiKey || !apiSecret) return null;
  if (!/^(wss?|https?):\/\/[^\s/]+/i.test(url)) return null;
  if (env.CHAT_STAGE_MODE?.trim().toLowerCase() === "off") return null;
  return { url, apiKey, apiSecret };
}

/** The address a browser connects to (wss://…). */
export const stageVideoSocketUrl = (config: StageVideoConfig) => config.url.replace(/^http/i, "ws");
/** The address this server calls LiveKit's API at (https://…). */
export const stageVideoApiUrl = (config: StageVideoConfig) => config.url.replace(/^ws/i, "http");

/** The LiveKit room for a chat room: always "chat-<room slug>", so nothing has to be remembered. */
export const stageVideoRoom = (room: ChatRoom) => `chat-${room}`;
export const chatRoomOfStageVideoRoom = (name: unknown): ChatRoom | null =>
  typeof name === "string" && name.startsWith("chat-") ? parseChatRoom(name.slice(5)) : null;
/** Who the broadcast (StreamYard, through the ingress) is in the LiveKit room. */
export const STAGE_BROADCAST_IDENTITY = "stage-broadcast";

/** One RTMP ingress as this app uses it. `streamKey` is a secret: admins only, never logged. */
export type StageIngress = {
  id: string;
  url: string;
  streamKey: string;
  publishing: boolean;
  /** #503: when LiveKit says this broadcast began (ms), if it says. The same for every server that asks. */
  startedAt?: number;
};

/** What this app asks of LiveKit. lib/chatStageLiveKit.ts is the real one. */
export interface StageVideoApi {
  ingresses(videoRoom: string): Promise<StageIngress[]>;
  createIngress(videoRoom: string): Promise<StageIngress>;
  deleteIngress(id: string): Promise<void>;
  /** Ends the LiveKit room, which disconnects everyone watching. */
  deleteRoom(videoRoom: string): Promise<void>;
  viewerToken(videoRoom: string, identity: string, name: string): Promise<string>;
}

/** Started (an ingress exists) and publishing: live. Started only: waiting. Otherwise off. */
export function stageStateOf(ingresses: readonly Pick<StageIngress, "publishing">[]): StageState {
  if (!ingresses.length) return "off";
  return ingresses.some((ingress) => ingress.publishing) ? "live" : "waiting";
}

/** How long one answer from LiveKit is reused by this server (like the radio playout's few seconds). */
export const STAGE_STATE_MEMORY_MS = 4_000;
const remembered = new Map<ChatRoom, { at: number; state: StageState }>();
const reading = new Map<ChatRoom, Promise<StageState>>();

/**
 * Whether a room is live, asked of LiveKit at most once per window per room by this server however
 * many members ask; requests that arrive during a read wait for that read. A failed read is
 * remembered as "off" for the same window, so a LiveKit outage is not hammered either.
 */
export function sharedStageState(room: ChatRoom, read: () => Promise<StageState>, now = Date.now()): Promise<StageState> {
  const known = remembered.get(room);
  if (known && now >= known.at && now - known.at < STAGE_STATE_MEMORY_MS) return Promise.resolve(known.state);
  const pending = reading.get(room);
  if (pending) return pending;
  const current: Promise<StageState> = read()
    .catch((): StageState => "off")
    .then((state) => {
      // Aged from when the read began. Skipped if the room was forgotten (started or ended) meanwhile.
      if (reading.get(room) === current) remembered.set(room, { at: now, state });
      return state;
    })
    .finally(() => {
      if (reading.get(room) === current) reading.delete(room);
    });
  reading.set(room, current);
  return current;
}

/** Forget what is remembered (after a start or an end, a LiveKit webhook, and in tests). */
export function forgetStageState(room?: ChatRoom) {
  if (room) {
    remembered.delete(room);
    reading.delete(room);
  } else {
    remembered.clear();
    reading.clear();
  }
}

/** One read of a room's state from LiveKit. */
export const readStageState = async (api: StageVideoApi, room: ChatRoom) =>
  stageStateOf(await api.ingresses(stageVideoRoom(room)));

/** Start: the room's ingress, made only when there is none (so the address and key stay the same). */
export async function startStageVideo(api: StageVideoApi, room: ChatRoom): Promise<StageIngress> {
  const videoRoom = stageVideoRoom(room);
  const [existing] = await api.ingresses(videoRoom);
  return existing ?? (await api.createIngress(videoRoom));
}

/** End: every ingress of the room is deleted, then the LiveKit room itself (viewers are disconnected). */
export async function endStageVideo(api: StageVideoApi, room: ChatRoom): Promise<void> {
  const videoRoom = stageVideoRoom(room);
  for (const ingress of await api.ingresses(videoRoom)) await api.deleteIngress(ingress.id);
  // A room nobody joined does not exist: that is not a failure to end.
  await api.deleteRoom(videoRoom).catch(() => undefined);
}

/**
 * A viewer's identity in the LiveKit room: the member's id, plus a short per-connection suffix.
 * LiveKit disconnects an earlier connection with the same identity, so without the suffix a member
 * watching in two tabs (or on a computer and a phone) would keep knocking themselves off.
 */
export const stageViewerIdentity = (memberId: string, connection: string) => `${memberId}#${connection}`;
/** The member behind a viewer identity (for counting people rather than tabs). */
export const stageViewerMember = (identity: string) => identity.split("#")[0];

/** The few fields of a LiveKit webhook this app reads (after its signature has been checked). */
export type StageWebhookEvent = { id: string; event: string; room: string; participant: string };

/**
 * What a LiveKit webhook means for a chat room: its live video (probably) came on, or went off.
 * Only LiveKit rooms named "chat-<room>" count, and only events about the room, its ingress or the
 * broadcast itself; a viewer joining or leaving means nothing here. The answer is a hint for what
 * to do next: whether the room IS live is always read from LiveKit (sharedStageState).
 */
export function stageWebhookChange(event: StageWebhookEvent): { room: ChatRoom; live: boolean } | null {
  const room = chatRoomOfStageVideoRoom(event.room);
  if (!room) return null;
  const broadcast = event.participant === STAGE_BROADCAST_IDENTITY;
  switch (event.event) {
    case "ingress_started":
    case "room_started":
      return { room, live: true };
    case "track_published":
      return broadcast ? { room, live: true } : null;
    case "ingress_ended":
    case "room_finished":
      return { room, live: false };
    case "participant_left":
      return broadcast ? { room, live: false } : null;
    default:
      return null;
  }
}

/** LiveKit retries and can repeat a webhook: each event id is acted on once (per server instance). */
const WEBHOOK_MEMORY = 500;
const seenWebhooks = new Set<string>();
export function stageWebhookIsNew(id: string) {
  if (!id) return true;
  if (seenWebhooks.has(id)) return false;
  if (seenWebhooks.size >= WEBHOOK_MEMORY) seenWebhooks.delete(seenWebhooks.values().next().value!);
  seenWebhooks.add(id);
  return true;
}
/** For tests. */
export const forgetStageWebhooks = () => seenWebhooks.clear();
