/** Local delivery state is deliberately separate from server message/read cursors. */
export type PendingChatMessage = {
  ownerId: string; scope: string; clientId: string; action: 'send' | 'request'; targetId: string;
  body: string; attachmentIds: string[]; createdAt: string;
  status: 'sending' | 'failed' | 'sent'; error?: string; serverId?: string;
};
export type ConfirmedChatMessage = { id: string; client_id?: string | null; revision?: number };
export function pendingForScope(rows: PendingChatMessage[], ownerId: string, scope: string | null) {
  return rows.filter(row => row.ownerId === ownerId && row.scope === scope);
}
export function reconcilePendingMessages(rows: PendingChatMessage[], ownerId: string, scope: string, confirmed: ConfirmedChatMessage[]) {
  const ids = new Set(confirmed.map(message => message.id));
  const clients = new Set(confirmed.map(message => message.client_id).filter(Boolean));
  return rows.filter(row => row.ownerId !== ownerId || row.scope !== scope || (!clients.has(row.clientId) && (!row.serverId || !ids.has(row.serverId))));
}
export function mergeConfirmedMessages<T extends ConfirmedChatMessage>(current: T[], incoming: T[]): T[] {
  const merged = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) if ((merged.get(message.id)?.revision ?? 0) <= (message.revision ?? 0)) merged.set(message.id, message);
  return [...merged.values()];
}
