import { beforeEach, expect, it, vi } from 'vitest';
const ai=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/chatOpenAI',()=>({runNanoChat:ai}));
import { deliverRoomSummary, summaryFingerprint } from '@/lib/chatRoomSummary';
import { parseSummaryCommand } from '@/lib/chatSummaryCommand';
import type { SupabaseClient } from '@supabase/supabase-js';
const rows=[{id:'one',author_label:'Jammie',body:'A useful discussion',created_at:'2026-09-16T10:00:00.000Z',edited_at:null}];
let results:Record<string,unknown[]>;let filters:unknown[][];let rpc:ReturnType<typeof vi.fn>;
function client(){return {from:(table:string)=>{const result=results[table].shift();const q:Record<string,unknown>={};for(const method of ['select','eq','in','order','limit','upsert'])q[method]=(...args:unknown[])=>{filters.push([table,method,...args]);return q;};q.maybeSingle=()=>Promise.resolve(result);q.then=(resolve:(r:unknown)=>void)=>Promise.resolve(result).then(resolve);return q;},rpc} as unknown as SupabaseClient;}
beforeEach(()=>{ai.mockReset();ai.mockResolvedValue('Topics: trading discipline. Key message: Jammie discussed discipline.');filters=[];results={chat_summary_deliveries:[{data:null},{data:{id:'delivery'}}],longboard_chat_messages:[{data:[...rows]}]};rpc=vi.fn(async(name:string)=>({data:name==='reserve_chat_summary'?true:name==='claim_chat_summary'?{state:'generate'}:true}));});
it('parses aliases and rejects malformed commands without treating ordinary text as a command',()=>{
 expect(parseSummaryCommand('/summary','social')).toEqual({room:'social'});
 expect(parseSummaryCommand('/SUMMARY ss','main')).toEqual({room:'shortscout'});
 expect(parseSummaryCommand('/summary LB','social')).toEqual({room:'main'});
 expect(parseSummaryCommand('/summary secret','main')).toHaveProperty('error');
 expect(parseSummaryCommand('/summary lb extra','main')).toHaveProperty('error');
 expect(parseSummaryCommand('Hello /summary','main')).toBeNull();
});
it('generates from the room-bounded latest 50 and delivers only to the verified actor',async()=>{
 expect(await deliverRoomSummary(client(),'actor','main','request')).toEqual({id:'delivery',cached:false});
 expect(filters).toContainEqual(['longboard_chat_messages','eq','room_slug','main']);
 expect(filters).toContainEqual(['longboard_chat_messages','limit',50]);
 expect(filters).toContainEqual(['chat_summary_deliveries','eq','account_id','actor']);
 expect(filters).toContainEqual(['chat_summary_deliveries','upsert',expect.objectContaining({account_id:'actor',room_slug:'main',body:expect.stringContaining('1 message')}),expect.anything()]);
 expect(ai).toHaveBeenCalledOnce();expect(ai.mock.calls[0][0].instructions).toContain('untrusted');
});
it('reuses matching cache without making an AI call',async()=>{
 rpc.mockImplementation(async(name:string)=>({data:name==='claim_chat_summary'?{state:'cached',body:'Cached summary'}:true}));
 expect((await deliverRoomSummary(client(),'actor','social','request')).cached).toBe(true);expect(ai).not.toHaveBeenCalled();
});
it('deduplicates delivery retries before cooldown or generation',async()=>{
 results.chat_summary_deliveries=[{data:{id:'existing',room_slug:'main'}}];
 expect((await deliverRoomSummary(client(),'actor','main','request')).id).toBe('existing');expect(rpc).not.toHaveBeenCalled();
});
it('stops when rate-limited or another generation owns the room',async()=>{
 rpc.mockResolvedValue({data:false});await expect(deliverRoomSummary(client(),'actor','main','request')).rejects.toMatchObject({status:429});expect(ai).not.toHaveBeenCalled();
});
it('does not deliver a failed or busy summary and releases failed generation leases',async()=>{
 ai.mockRejectedValue(new Error('secret provider error'));
 await expect(deliverRoomSummary(client(),'actor','main','request')).rejects.toThrow('could not be generated');
 expect(rpc).toHaveBeenLastCalledWith('finish_chat_summary',expect.objectContaining({summary:null}));
 expect(filters.some(f=>f[1]==='upsert')).toBe(false);
});
it('handles empty rooms without an AI request',async()=>{
 results.longboard_chat_messages=[{data:[]}];await deliverRoomSummary(client(),'actor','main','request');
 expect(ai).not.toHaveBeenCalled();expect(rpc).toHaveBeenCalledWith('finish_chat_summary',expect.objectContaining({summary:expect.stringContaining('No messages')}));
});
it('invalidates fingerprints for additions, edits and deletions',()=>{
 const original=summaryFingerprint(rows);
 expect(summaryFingerprint([...rows,{...rows[0],id:'two'}])).not.toBe(original);
 expect(summaryFingerprint([{...rows[0],body:'Edited'}])).not.toBe(original);
 expect(summaryFingerprint([])).not.toBe(original);
});
it('does not duplicate AI generation while the cache is claimed',async()=>{
 rpc.mockImplementation(async(name:string)=>({data:name==='claim_chat_summary'?{state:'busy'}:true}));
 await expect(deliverRoomSummary(client(),'actor','main','request')).rejects.toMatchObject({status:409});expect(ai).not.toHaveBeenCalled();
});
