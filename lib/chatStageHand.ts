// #508 Stage mode: "Raise hand". The pieces shared by the server route and the stage (no imports on
// purpose, so the stage's lazy chunk carries nothing extra and no LiveKit library comes with it).
//
// Nothing is stored in the database. A raised hand is one attribute on the viewer's own LiveKit
// participant: {"hand":"<raised at, ms>"}; lowering removes it. Only this server sets it (a viewer's
// token can never change their own details), LiveKit tells every connected player when it changes,
// and it goes by itself when the viewer disconnects or the LiveKit room ends.

/** The participant attribute that holds a raised hand: when it was raised, in ms. */
export const STAGE_HAND_ATTRIBUTE = "hand";
/** How many identities one "lower" request may name. */
export const STAGE_HAND_MAX_IDENTITIES = 20;

/** One participant of the LiveKit room, as far as hands go. `hand` is the raw attribute. */
export type StageHandParticipant = { identity: string; name: string; hand?: string };
/** One person with their hand up. `identities` are that person's connections (tabs) with a hand. */
export type StageHand = { member: string; name: string; at: number; identities: string[] };

/** A viewer identity is "<member id>#<8 hex>" (lib/chatStageVideo.ts stageViewerIdentity). */
const VIEWER_IDENTITY = /^[^#\s]+#[0-9a-f]{8}$/;
export const isStageViewerIdentity = (identity: unknown): identity is string =>
  typeof identity === "string" && identity.length <= 120 && VIEWER_IDENTITY.test(identity);
/** The member behind a viewer identity. */
export const stageHandMember = (identity: string) => identity.split("#")[0];
/** Whether this identity is one of that member's own connections. */
export const stageHandIsOwn = (memberId: string, identity: unknown) =>
  !!memberId && isStageViewerIdentity(identity) && identity.startsWith(`${memberId}#`);

/** When a hand was raised (ms), or null when the attribute says no hand. */
export function parseStageHandAt(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,16}$/.test(value)) return null;
  const at = Number(value);
  return at > 0 ? at : null;
}
/** The attributes to set: the time to raise, null to lower (LiveKit removes an attribute set to ""). */
export const stageHandAttributes = (at: number | null): Record<string, string> => ({
  [STAGE_HAND_ATTRIBUTE]: at ? String(Math.floor(at)) : "",
});

/**
 * Who has a hand up, oldest first. One entry per member: someone watching in two tabs with a hand
 * up in both counts once, from the earlier of the two. The broadcast itself never counts.
 */
export function stageHands(participants: readonly StageHandParticipant[]): StageHand[] {
  const byMember = new Map<string, StageHand>();
  for (const participant of participants) {
    if (!isStageViewerIdentity(participant.identity)) continue;
    const at = parseStageHandAt(participant.hand);
    if (at === null) continue;
    const member = stageHandMember(participant.identity);
    const known = byMember.get(member);
    if (!known) byMember.set(member, { member, name: participant.name, at, identities: [participant.identity] });
    else {
      known.identities.push(participant.identity);
      if (at < known.at) {
        known.at = at;
        known.name = participant.name || known.name;
      }
    }
  }
  return [...byMember.values()].sort((a, b) => a.at - b.at || (a.member < b.member ? -1 : 1));
}

/** "1 hand up", "3 hands up". */
export const stageHandCountLabel = (count: number) => `${count} ${count === 1 ? "hand" : "hands"} up`;

/** How long ago a hand went up, for the admin's list: "just now", "45 sec ago", "3 min ago", "1 hr 5 min ago". */
export function stageHandAgo(at: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} hr${rest ? ` ${rest} min` : ""} ago`;
}

/** What the hand route asks of LiveKit. lib/chatStageLiveKit.ts (stageHandApi) is the real one. */
export interface StageHandApi {
  /** Everyone in the LiveKit room right now (empty when there is no such room). */
  participants(videoRoom: string): Promise<StageHandParticipant[]>;
  /** Raises (a time) or lowers (null) one participant's hand. False: nobody with that identity is in the room. */
  setHand(videoRoom: string, identity: string, at: number | null): Promise<boolean>;
}

/** Lowers the hand on each of these identities; one that has already left is not a failure. */
export async function lowerStageHands(api: StageHandApi, videoRoom: string, identities: readonly string[]): Promise<number> {
  const done = await Promise.all(identities.map((identity) => api.setHand(videoRoom, identity, null)));
  return done.filter(Boolean).length;
}

/** Lowers every hand in the room (an admin's "Lower all"). */
export async function lowerAllStageHands(api: StageHandApi, videoRoom: string): Promise<number> {
  const raised = stageHands(await api.participants(videoRoom)).flatMap((hand) => hand.identities);
  return lowerStageHands(api, videoRoom, raised);
}
