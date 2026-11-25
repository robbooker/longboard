// #502 Stage mode's live video: the pieces that need no LiveKit library (settings, names, the
// "is this room live" memory and who may do what). The LiveKit calls themselves are in
// lib/chatStageLiveKit.ts, behind the small StageVideoApi below so tests can stand in for LiveKit.
//
// Nothing is stored in the database: LiveKit is the record. A room has been "started" while an RTMP
// ingress exists for its LiveKit room, and it is "live" while that ingress is publishing.
// Never log an API key, secret, viewer token or stream key from here or from the routes.
import { parseChatRoom, type ChatRoom } from "./publicChat";
import { parseStageOnScreen, type StageOnScreen, type StageState } from "./chatStageLive";

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
  /** #507: the LiveKit room's metadata ("" when it has none), or null when there is no such room. */
  roomMetadata(videoRoom: string): Promise<string | null>;
  /** #507: sets the LiveKit room's metadata, making the room first when nobody has joined it yet. */
  setRoomMetadata(videoRoom: string, metadata: string): Promise<void>;
  viewerToken(videoRoom: string, identity: string, name: string): Promise<string>;
}

/** Started (an ingress exists) and publishing: live. Started only: waiting. Otherwise off. */
export function stageStateOf(ingresses: readonly Pick<StageIngress, "publishing">[]): StageState {
  if (!ingresses.length) return "off";
  return ingresses.some((ingress) => ingress.publishing) ? "live" : "waiting";
}

/** How long one answer from LiveKit is reused by this server (like the radio playout's few seconds). */
export const STAGE_STATE_MEMORY_MS = 4_000;

/**
 * One answer per room, asked of LiveKit at most once per window by this server however many members
 * ask; requests that arrive during a read wait for that read. A failed read is remembered as
 * `failed` for the same window, so a LiveKit outage is not hammered either.
 */
function roomMemory<T>(failed: T) {
  const remembered = new Map<ChatRoom, { at: number; value: T }>();
  const reading = new Map<ChatRoom, Promise<T>>();
  return {
    shared(room: ChatRoom, read: () => Promise<T>, now = Date.now()): Promise<T> {
      const known = remembered.get(room);
      if (known && now >= known.at && now - known.at < STAGE_STATE_MEMORY_MS) return Promise.resolve(known.value);
      const pending = reading.get(room);
      if (pending) return pending;
      const current: Promise<T> = read()
        .catch((): T => failed)
        .then((value) => {
          // Aged from when the read began. Skipped if the room was forgotten (started or ended) meanwhile.
          if (reading.get(room) === current) remembered.set(room, { at: now, value });
          return value;
        })
        .finally(() => {
          if (reading.get(room) === current) reading.delete(room);
        });
      reading.set(room, current);
      return current;
    },
    forget(room?: ChatRoom) {
      if (room) {
        remembered.delete(room);
        reading.delete(room);
      } else {
        remembered.clear();
        reading.clear();
      }
    },
  };
}
const stateMemory = roomMemory<StageState>("off");
const onScreenMemory = roomMemory<StageOnScreen | null>(null);

/** Whether a room is live (see roomMemory: one read per few seconds per room; a failed read is "off"). */
export const sharedStageState = (room: ChatRoom, read: () => Promise<StageState>, now = Date.now()) =>
  stateMemory.shared(room, read, now);
/** #507: the stock on screen in a room, remembered the same way (a failed read: nothing known). */
export const sharedStageOnScreen = (room: ChatRoom, read: () => Promise<StageOnScreen | null>, now = Date.now()) =>
  onScreenMemory.shared(room, read, now);

/** Forget what is remembered (after a start or an end, a new stock on screen, a LiveKit webhook, and in tests). */
export function forgetStageState(room?: ChatRoom) {
  stateMemory.forget(room);
  onScreenMemory.forget(room);
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

// #507: the stock on screen. It lives in the LiveKit room's metadata as {"onScreen":"APUS","at":<ms>}
// ({"onScreen":null,…} once cleared), so nothing is stored in the database and someone who opens the
// stage later reads the same thing. It goes when the LiveKit room does (End, or everyone gone).

/** The metadata to save for a stock on screen (null: cleared). */
export const stageOnScreenMetadata = (onScreen: StageOnScreen) => JSON.stringify({ onScreen: onScreen.symbol, at: onScreen.at });

/** What a LiveKit room's metadata says is on screen; null when it says nothing (or it is not ours). */
export function stageOnScreenOfMetadata(metadata: string | null | undefined): StageOnScreen | null {
  if (!metadata) return null;
  try {
    const value = JSON.parse(metadata) as { onScreen?: unknown; at?: unknown } | null;
    return value && typeof value === "object" && "onScreen" in value ? parseStageOnScreen({ symbol: value.onScreen, at: value.at }) : null;
  } catch {
    return null;
  }
}

/** One read of what is on screen in a room, from LiveKit. */
export const readStageOnScreen = async (api: StageVideoApi, room: ChatRoom) =>
  stageOnScreenOfMetadata(await api.roomMetadata(stageVideoRoom(room)));

/**
 * The host sets (or, with null, clears) the stock on screen. Only while the room's live video has
 * been started (its ingress exists): otherwise null comes back and nothing is saved.
 */
export async function setStageOnScreen(api: StageVideoApi, room: ChatRoom, symbol: string | null, now = Date.now()): Promise<StageOnScreen | null> {
  const videoRoom = stageVideoRoom(room);
  if (!(await api.ingresses(videoRoom)).length) return null;
  const onScreen: StageOnScreen = { symbol, at: now };
  await api.setRoomMetadata(videoRoom, stageOnScreenMetadata(onScreen));
  return onScreen;
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
