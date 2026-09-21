import { createHash, timingSafeEqual } from 'node:crypto';

export type GainersAlert = {sourceChannelId:string; sourceMessageId:number; postedAt:string; body:string};
export function gainersAuthorized(header:string|null,secret:string|undefined) {
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer ')) return false;
  return timingSafeEqual(createHash('sha256').update(header.slice(7)).digest(),createHash('sha256').update(secret).digest());
}
export function parseGainersAlert(value:unknown,channel:string,start:string,now=Date.now()):GainersAlert|null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p=value as Record<string,unknown>;
  if (Object.keys(p).some(key=>!['sourceChannelId','sourceMessageId','postedAt','body'].includes(key))) return null;
  if (typeof p.sourceChannelId!=='string' || !/^-?\d+$/.test(p.sourceChannelId) || p.sourceChannelId!==channel) return null;
  if (!Number.isSafeInteger(p.sourceMessageId) || Number(p.sourceMessageId)<=0) return null;
  if (typeof p.postedAt!=='string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(p.postedAt)) return null;
  const at=Date.parse(p.postedAt),since=Date.parse(start);
  if (!Number.isFinite(at)||!Number.isFinite(since)||at<since||at>now+300_000) return null;
  if (typeof p.body!=='string'||p.body.includes('\0')||!p.body.trim()||Array.from(p.body).length>4096) return null;
  return {sourceChannelId:p.sourceChannelId,sourceMessageId:p.sourceMessageId as number,postedAt:new Date(at).toISOString(),body:p.body};
}
