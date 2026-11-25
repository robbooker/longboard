// #502: the stage's live video over LiveKit. The only file that imports livekit-client, and it is
// imported lazily by the player (stageFeed.ts) when a viewer actually connects, so the library is
// downloaded by people watching a live room and by nobody else.
import {
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type RemoteAudioTrack,
  type RemoteTrack,
} from "livekit-client";
import { STAGE_BROADCAST_IDENTITY, stageViewerMember } from "@/lib/chatStageVideo";
import type { StageFeedConnect } from "./stageFeed";

export const connectStageFeed: StageFeedConnect = async ({ url, token, video, audio, signal, events }) => {
  // Adaptive stream: LiveKit sends the size the player is showing, and pauses a hidden one.
  // Viewers never publish, so nothing is asked of the camera or microphone.
  const room = new Room({ adaptiveStream: true, dynacast: false, disconnectOnPageLeave: true });
  let volume = 1;
  let sound: RemoteAudioTrack | null = null;
  let picture: RemoteTrack | null = null;
  const count = () => {
    const members = new Set<string>([stageViewerMember(room.localParticipant.identity)]);
    for (const identity of room.remoteParticipants.keys())
      if (identity !== STAGE_BROADCAST_IDENTITY) members.add(stageViewerMember(identity));
    events.viewers(members.size);
  };
  room
    .on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Video) {
        picture?.detach(video);
        picture = track;
        track.attach(video);
        events.video(true);
      } else if (track.kind === Track.Kind.Audio) {
        sound?.detach(audio);
        sound = track as RemoteAudioTrack;
        sound.attach(audio);
        sound.setVolume(volume);
      }
    })
    .on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track === picture) {
        track.detach(video);
        picture = null;
        events.video(false);
      } else if (track === sound) {
        track.detach(audio);
        sound = null;
      }
    })
    .on(RoomEvent.ParticipantConnected, count)
    .on(RoomEvent.ParticipantDisconnected, count)
    .on(RoomEvent.AudioPlaybackStatusChanged, () => events.audioBlocked(!room.canPlaybackAudio))
    .on(RoomEvent.Reconnecting, () => events.connection("reconnecting"))
    .on(RoomEvent.Reconnected, () => {
      events.connection("connected");
      count();
    })
    .on(RoomEvent.Disconnected, (reason) => {
      events.video(false);
      if (reason === DisconnectReason.CLIENT_INITIATED) return;
      events.connection(
        reason === DisconnectReason.ROOM_DELETED ||
          reason === DisconnectReason.ROOM_CLOSED ||
          reason === DisconnectReason.PARTICIPANT_REMOVED
          ? "ended"
          : "failed",
      );
    });
  // #511: let go of while still connecting: the attempt is abandoned at once, not after it succeeds.
  const abandon = () => void room.disconnect();
  signal.addEventListener("abort", abandon, { once: true });
  if (signal.aborted) throw new Error("closed");
  // LiveKit retries a dropped connection by itself (Reconnecting/Reconnected above).
  try {
    await room.connect(url, token, { autoSubscribe: true });
  } catch (error) {
    signal.removeEventListener("abort", abandon);
    void room.disconnect();
    throw error;
  }
  signal.removeEventListener("abort", abandon);
  if (signal.aborted) {
    void room.disconnect();
    throw new Error("closed");
  }
  events.connection("connected");
  events.audioBlocked(!room.canPlaybackAudio);
  count();
  return {
    startAudio: () => room.startAudio(),
    setVolume: (next) => {
      volume = next;
      sound?.setVolume(next);
    },
    close: () => {
      void room.disconnect();
    },
  };
};
