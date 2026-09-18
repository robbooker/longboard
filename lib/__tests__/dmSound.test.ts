import {describe,it,expect} from 'vitest';
import {DmSoundTracker,defaultDmSounds,dmTone,parseDmSounds} from '../dmSound';
import type {DirectConversation} from '../chatDirectMessages';
const row=(seq:number,extra:Partial<DirectConversation>={}):DirectConversation=>({id:'a',status:'accepted',incoming:true,otherId:'b',otherName:'Other',blockedByMe:false,unavailable:false,lastBody:'Hello',updatedAt:'now',unread:1,latestIncomingSeq:seq,...extra});
describe('DM sound arrival tracking',()=>{
 it('baselines history and only sounds newly incoming sequences once',()=>{const t=new DmSoundTracker();expect(t.observe([row(10)])).toEqual([]);expect(t.observe([row(11)])).toEqual(['a']);expect(t.observe([row(11)])).toEqual([]);});
 it('ignores self sends, edits and read count changes because incoming cursor is unchanged',()=>{const t=new DmSoundTracker();t.observe([row(10)]);expect(t.observe([row(10,{updatedAt:'later',lastBody:'Edited or self',unread:0})])).toEqual([]);});
 it('never replays a deleted latest message or history after deletion',()=>{const t=new DmSoundTracker();t.observe([row(10)]);expect(t.observe([row(9)])).toEqual([]);expect(t.observe([row(10)])).toEqual([]);});
 it('suppresses blocks, declined and system conversations and baselines unblocking',()=>{for(const extra of [{unavailable:true},{blockedByMe:true},{status:'declined' as const},{system:true}]){const t=new DmSoundTracker();t.observe([row(10)]);expect(t.observe([row(11,extra)])).toEqual([]);expect(t.observe([row(12)])).toEqual([]);expect(t.observe([row(13)])).toEqual(['a']);}});
 it('detects a newly arriving request after an empty initial inbox',()=>{const t=new DmSoundTracker();t.observe([]);expect(t.observe([row(1,{status:'pending'})])).toEqual(['a']);});
 it('advances muted history and deduplicates disappearing rows',()=>{const t=new DmSoundTracker();t.observe([row(1)]);t.observe([row(2)]);t.observe([]);expect(t.observe([row(2)])).toEqual([]);});
 it('coalesces delayed arrivals per conversation rather than replaying a message burst',()=>{const t=new DmSoundTracker();t.observe([row(1)]);expect(t.observe([row(100)])).toEqual(['a']);});
});
it('validates persistent preferences and isolates supported choices',()=>{expect(parseDmSounds('broken')).toEqual(defaultDmSounds());const id='00000000-0000-4000-8000-000000000001';const prefs=parseDmSounds(JSON.stringify({enabled:true,defaultTone:'pulse',conversations:{[id]:'chime',unknown:'evil'}}));expect(dmTone(prefs,id)).toBe('chime');expect(dmTone(prefs,'new')).toBe('pulse');prefs.conversations[id]='mute';expect(dmTone(prefs,id)).toBeNull();prefs.enabled=false;expect(dmTone(prefs,'new')).toBeNull();});
