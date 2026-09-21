import { expect,it,vi } from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {withMessageMemberships} from '@/lib/chatMembershipProjection';
const id='00000000-0000-4000-8000-000000000001';
it('batches authorized authors and ignores unrequested data, bot and legacy identities',async()=>{
 const rpc=vi.fn().mockResolvedValue({data:[{member_id:id,memberships:['SS','LB','ADMIN','LB']},{member_id:'forged',memberships:['LB']}]});
 const rows=await withMessageMemberships({rpc} as unknown as SupabaseClient,[{member_id:id},{sender_id:id},{member_id:id,bot_slug:'buddy'},{member_id:null}]);
 expect(rpc).toHaveBeenCalledExactlyOnceWith('chat_member_memberships',{p_member_ids:[id]});
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
