import { expect,it,vi } from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {withMessageMemberships} from '@/lib/chatMembershipProjection';
const id='00000000-0000-4000-8000-000000000001';
// SS badges come from the local ShortScout copy (A6): one RPC after the sources read.
const db=(sources:(()=>Promise<unknown>)|unknown,paid:unknown[]=[id])=>{
 const next=typeof sources==='function'?sources as ()=>Promise<unknown>:async()=>sources;
 return vi.fn(async(name:string)=>name==='chat_shortscout_paid_subjects'?{data:paid}:next());
};
it('batches authorized authors and ignores unrequested data, bot and legacy identities',async()=>{
 const rpc=db({data:[{member_id:id,longboard:true,shortscout_subject:id},{member_id:'forged',longboard:true,shortscout_subject:'forged'}]});
 const rows=await withMessageMemberships({rpc} as unknown as SupabaseClient,[{member_id:id},{sender_id:id},{member_id:id,bot_slug:'buddy'},{member_id:null}]);
 expect(rpc).toHaveBeenNthCalledWith(1,'chat_member_membership_sources',{p_member_ids:[id]});
 expect(rpc).toHaveBeenNthCalledWith(2,'chat_shortscout_paid_subjects',{p_subjects:[id]});expect(rpc).toHaveBeenCalledTimes(2);
 expect(rows.map(row=>row.memberships)).toEqual([['LB','SS'],['LB','SS'],[],[]]);
});
it('hides stale/injected badges on lookup failure and never guesses from room',async()=>{
 const rpc=vi.fn().mockRejectedValue(Error('unavailable'));
 const [row]=await withMessageMemberships({rpc} as unknown as SupabaseClient,[{member_id:id,memberships:['LB'],room_slug:'main'}]);
 expect(row.memberships).toEqual([]);
});
it('does not query for bots or missing identities',async()=>{
 const rpc=vi.fn();await withMessageMemberships({rpc} as unknown as SupabaseClient,[{member_id:id,bot_slug:'buddy'},{member_id:null}]);expect(rpc).not.toHaveBeenCalled();
});
it('caps batches and replaces removed memberships on subsequent reads',async()=>{
 const messages=Array.from({length:201},(_,n)=>({member_id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`}));
 const rpc=vi.fn().mockResolvedValue({data:[]});
 const rows=await withMessageMemberships({rpc} as unknown as SupabaseClient,messages);
 expect(rpc).toHaveBeenCalledTimes(2);expect(rpc.mock.calls.map(call=>call[1].p_member_ids.length)).toEqual([200,1]);expect(rows.every(row=>row.memberships.length===0)).toBe(true);
});

it('reflects bridge revocation even when the copy still says paid',async()=>{
 const reads=[{data:[{member_id:id,longboard:true,shortscout_subject:id}]},{data:[{member_id:id,longboard:true,shortscout_subject:null}]}];
 const rpc=db(async()=>reads.shift());
 expect((await withMessageMemberships({rpc} as unknown as SupabaseClient,[{member_id:id}]))[0].memberships).toEqual(['LB','SS']);
 expect((await withMessageMemberships({rpc} as unknown as SupabaseClient,[{member_id:id}]))[0].memberships).toEqual(['LB']);
});
it('keeps independent LB membership when the copy has no current SS answer',async()=>{
 const rpc=db({data:[{member_id:id,longboard:true,shortscout_subject:id}]},[]);
 expect((await withMessageMemberships({rpc} as unknown as SupabaseClient,[{member_id:id}]))[0].memberships).toEqual(['LB']);
});
it('hides SS badges, keeping LB, when the copy cannot be read',async()=>{
 const rpc=vi.fn(async(name:string)=>name==='chat_shortscout_paid_subjects'?{error:{message:'down'}}:{data:[{member_id:id,longboard:true,shortscout_subject:id}]});
 expect((await withMessageMemberships({rpc} as unknown as SupabaseClient,[{member_id:id}]))[0].memberships).toEqual(['LB']);
});
