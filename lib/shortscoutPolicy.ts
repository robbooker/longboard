/** Chat-only policy. Ordinary ShortScout website authentication is independent. */
export function isPaidShortScoutLevel(level:unknown):boolean {
 return typeof level==='string'&&['monthly','annual','lifetime','mastermind'].includes(level);
}
export function shortscoutChatEntitlements(level:unknown){
 return {shortscout:level==='mastermind',shortscoutMember:isPaidShortScoutLevel(level)};
}
export function shortscoutRoomRequiresMastermind(room:unknown){
 return room==='shortscout'||room==='ss-announcements'||room==='ss-recordings';
}
