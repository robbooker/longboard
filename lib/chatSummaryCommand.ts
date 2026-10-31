import { roomHasSummaries, type ChatRoom } from "./publicChat";
/** null means a normal message; an explicit error never falls through into a public post. */
export function parseSummaryCommand(
  body: string,
  currentRoom: ChatRoom,
): { room: ChatRoom } | { error: string } | null {
  if (!/^\/summary(?:\s|$)/i.test(body.trim())) return null;
  const parts = body.trim().split(/\s+/);
  const rooms: Record<string, ChatRoom> = {
    lb: "main",
    main: "main",
    social: "social",
    ss: "shortscout",
    shortscout: "shortscout",
    developers: "developers",
    "lb-review": "lb-review",
    admins: "admins",
  };
  if (parts.length > 2 || (parts[1] && !rooms[parts[1].toLowerCase()]))
    return { error: "Use /summary, /summary LB, /summary SOCIAL or /summary SS." };
  const room = parts[1] ? rooms[parts[1].toLowerCase()] : currentRoom;
  return roomHasSummaries(room) ? { room } : { error: "Summaries are off for the Admins room." };
}
