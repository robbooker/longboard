// #502: the real LiveKit behind StageVideoApi (lib/chatStageVideo.ts). Server only: this is the one
// file that imports livekit-server-sdk. Never log what these calls return (stream keys, tokens).
import {
  AccessToken,
  IngressClient,
  IngressInput,
  RoomServiceClient,
  WebhookReceiver,
  type IngressInfo,
  type VideoGrant,
} from "livekit-server-sdk";
import { STAGE_HAND_ATTRIBUTE, stageHandAttributes, type StageHandApi } from "./chatStageHand";
import {
  STAGE_BROADCAST_IDENTITY,
  STAGE_TAB_ATTRIBUTE,
  stageVideoApiUrl,
  type StageIngress,
  type StageVideoApi,
  type StageVideoConfig,
  type StageWebhookEvent,
} from "./chatStageVideo";

/** IngressState.Status.ENDPOINT_PUBLISHING: the encoder (StreamYard) is connected and sending. */
const ENDPOINT_PUBLISHING = 2;
/**
 * A viewer's token is only needed to join. #522: one minute, down from ten. The player asks for it
 * as the last thing before it connects (the player code is already downloaded by then), so the
 * minute only has to cover the answer reaching a slow phone and the connection opening.
 * What expiry does and does not do (livekit-client 2.x, read in node_modules): a viewer who is
 * already connected stays connected when the token lapses; LiveKit hands a connected client a
 * renewed token of its own (the client keeps it: RTCEngine `onTokenRefresh`) and uses that when it
 * reconnects by itself. If a reconnect is ever refused because the token it holds has lapsed, the
 * client gives up ("could not reconnect, token might be expired") and the player asks this server
 * for a fresh one (useStageLink.ts), which checks the member's access again.
 */
export const STAGE_VIEWER_TOKEN_TTL_SECONDS = 60;

/** Watch only: a viewer can never publish video, audio or data, or change their own details. */
export const stageViewerGrant = (videoRoom: string): VideoGrant => ({
  room: videoRoom,
  roomJoin: true,
  canSubscribe: true,
  canPublish: false,
  canPublishData: false,
  canUpdateOwnMetadata: false,
});

// LiveKit counts in nanoseconds.
const ms = (nanoseconds: bigint | undefined) => (nanoseconds ? Math.floor(Number(nanoseconds) / 1e6) : 0);
const ingressOf = (info: IngressInfo): StageIngress => {
  // When it was last broadcast to (LiveKit keeps no "created at" for an ingress).
  const activeAt = Math.max(ms(info.state?.startedAt), ms(info.state?.endedAt));
  return {
    id: info.ingressId,
    url: info.url,
    streamKey: info.streamKey,
    publishing: info.state?.status === ENDPOINT_PUBLISHING,
    ...(info.state?.startedAt ? { startedAt: ms(info.state.startedAt) } : {}),
    ...(activeAt ? { activeAt } : {}),
  };
};

/** LiveKit's answer when the room or the participant is not there (a Twirp "not_found", HTTP 404). */
const notFound = (error: unknown) => {
  const { code, status } = (error ?? {}) as { code?: unknown; status?: unknown };
  return code === "not_found" || status === 404;
};

export function stageVideoApi(config: StageVideoConfig): StageVideoApi {
  const host = stageVideoApiUrl(config);
  const ingress = new IngressClient(host, config.apiKey, config.apiSecret);
  const rooms = () => new RoomServiceClient(host, config.apiKey, config.apiSecret);
  return {
    ingresses: async (videoRoom) =>
      (await ingress.listIngress({ roomName: videoRoom }))
        // LiveKit filters by room; the check stays here so another room's key can never be handed out.
        .filter((info) => info.roomName === videoRoom)
        .map(ingressOf),
    createIngress: async (videoRoom) =>
      ingressOf(
        await ingress.createIngress(IngressInput.RTMP_INPUT, {
          name: videoRoom,
          roomName: videoRoom,
          participantIdentity: STAGE_BROADCAST_IDENTITY,
          participantName: "Live video",
        }),
      ),
    deleteIngress: async (id) => {
      await ingress.deleteIngress(id);
    },
    roomMetadata: async (videoRoom) => {
      const [found] = (await rooms().listRooms([videoRoom])).filter((info) => info.name === videoRoom);
      return found ? found.metadata : null;
    },
    setRoomMetadata: async (videoRoom, metadata) => {
      try {
        await rooms().updateRoomMetadata(videoRoom, metadata);
      } catch {
        // Nobody has joined yet, so LiveKit has no such room: make it, carrying the metadata. The
        // broadcast and the viewers then join this room (making a room that exists changes nothing).
        await rooms().createRoom({ name: videoRoom, metadata });
      }
    },
    viewerToken: async (videoRoom, identity, name, tab) => {
      const token = new AccessToken(config.apiKey, config.apiSecret, {
        identity,
        name,
        ttl: STAGE_VIEWER_TOKEN_TTL_SECONDS,
        ...(tab ? { attributes: { [STAGE_TAB_ATTRIBUTE]: tab } } : {}),
      });
      token.addGrant(stageViewerGrant(videoRoom));
      return token.toJwt();
    },
    viewer: async (videoRoom, identity) => {
      try {
        const info = await rooms().getParticipant(videoRoom, identity);
        const tab = info.attributes?.[STAGE_TAB_ATTRIBUTE];
        return { joinedAt: Number(info.joinedAtMs) || Number(info.joinedAt) * 1000, ...(tab ? { tab } : {}) };
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },
    removeViewer: async (videoRoom, identity, revoke) => {
      try {
        await rooms().removeParticipant(videoRoom, identity, revoke ? { revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)) } : undefined);
        return true;
      } catch (error) {
        if (notFound(error)) return false;
        throw error;
      }
    },
    closeRoom: async (videoRoom) => {
      try {
        await rooms().deleteRoom(videoRoom);
      } catch (error) {
        if (!notFound(error)) throw error;
      }
    },
    videoRooms: async () => (await rooms().listRooms()).map((info) => info.name),
  };
}

/**
 * #508: raised hands. The hand is an attribute on the viewer's participant, set here by the server
 * (a viewer's own token cannot change it); LiveKit pushes the change to everyone connected.
 */
export function stageHandApi(config: StageVideoConfig): StageHandApi {
  const rooms = () => new RoomServiceClient(stageVideoApiUrl(config), config.apiKey, config.apiSecret);
  return {
    participants: async (videoRoom) => {
      try {
        return (await rooms().listParticipants(videoRoom)).map((info) => ({
          identity: info.identity,
          name: info.name,
          hand: info.attributes?.[STAGE_HAND_ATTRIBUTE],
        }));
      } catch (error) {
        if (notFound(error)) return [];
        throw error;
      }
    },
    setHand: async (videoRoom, identity, at) => {
      try {
        await rooms().updateParticipant(videoRoom, identity, { attributes: stageHandAttributes(at) });
        return true;
      } catch (error) {
        if (notFound(error)) return false;
        throw error;
      }
    },
  };
}

/**
 * A LiveKit webhook, checked against this project's key and secret (the signature, and the hash of
 * the raw body it signs). Returns the few fields this app reads, or null when it is not genuine.
 */
export async function receiveStageWebhook(config: StageVideoConfig, rawBody: string, authorization: string | null): Promise<StageWebhookEvent | null> {
  try {
    const event = await new WebhookReceiver(config.apiKey, config.apiSecret).receive(rawBody, authorization ?? undefined);
    return {
      id: event.id,
      event: event.event,
      room: event.room?.name || event.ingressInfo?.roomName || "",
      participant: event.participant?.identity ?? "",
    };
  } catch {
    return null;
  }
}
