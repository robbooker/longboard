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
  stageVideoApiUrl,
  type StageIngress,
  type StageVideoApi,
  type StageVideoConfig,
  type StageWebhookEvent,
} from "./chatStageVideo";

/** IngressState.Status.ENDPOINT_PUBLISHING: the encoder (StreamYard) is connected and sending. */
const ENDPOINT_PUBLISHING = 2;
/** A viewer's token is only needed to join; LiveKit keeps a joined viewer connected after it lapses. */
export const STAGE_VIEWER_TOKEN_TTL_SECONDS = 10 * 60;

/** Watch only: a viewer can never publish video, audio or data, or change their own details. */
export const stageViewerGrant = (videoRoom: string): VideoGrant => ({
  room: videoRoom,
  roomJoin: true,
  canSubscribe: true,
  canPublish: false,
  canPublishData: false,
  canUpdateOwnMetadata: false,
});

const ingressOf = (info: IngressInfo): StageIngress => ({
  id: info.ingressId,
  url: info.url,
  streamKey: info.streamKey,
  publishing: info.state?.status === ENDPOINT_PUBLISHING,
  // LiveKit counts in nanoseconds.
  ...(info.state?.startedAt ? { startedAt: Math.floor(Number(info.state.startedAt) / 1e6) } : {}),
});

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
    deleteRoom: async (videoRoom) => {
      await rooms().deleteRoom(videoRoom);
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
    viewerToken: async (videoRoom, identity, name) => {
      const token = new AccessToken(config.apiKey, config.apiSecret, {
        identity,
        name,
        ttl: STAGE_VIEWER_TOKEN_TTL_SECONDS,
      });
      token.addGrant(stageViewerGrant(videoRoom));
      return token.toJwt();
    },
  };
}

/** LiveKit's answer when the room or the participant is not there (a Twirp "not_found", HTTP 404). */
const notFound = (error: unknown) => {
  const { code, status } = (error ?? {}) as { code?: unknown; status?: unknown };
  return code === "not_found" || status === 404;
};

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
