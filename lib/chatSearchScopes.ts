import type { ChatRoom } from "./publicChat";

export const CHAT_SEARCH_SCOPES = [
  { value: "main", label: "LB", rooms: ["main"] },
  { value: "shortscout", label: "SS", rooms: ["shortscout"] },
  { value: "social", label: "Social", rooms: ["social"] },
  { value: "lb-social", label: "LB + Social", rooms: ["main", "social"] },
  { value: "ss-social", label: "SS + Social", rooms: ["shortscout", "social"] },
  { value: "developers", label: "Developers", rooms: ["developers"] },
  { value: "lb-review", label: "LB Review", rooms: ["lb-review"] },
  { value: "runner-watch", label: "Runner Watch", rooms: ["runner-watch"] },
  { value: "admins", label: "Admins", rooms: ["admins"] },
] as const;
export type ChatSearchScope = (typeof CHAT_SEARCH_SCOPES)[number]["value"];
export function chatSearchScopes(rooms: readonly ChatRoom[]) {
  return CHAT_SEARCH_SCOPES.filter((scope) => scope.rooms.every((room) => rooms.includes(room)));
}
export function chatSearchScopeRooms(scope: string): readonly ChatRoom[] | null {
  return CHAT_SEARCH_SCOPES.find((option) => option.value === scope)?.rooms ?? null;
}
