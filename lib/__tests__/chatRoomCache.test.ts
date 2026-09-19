import {describe,it,expect} from 'vitest';
import {ChatRoomCache,type RoomSnapshot} from '../chatRoomCache';
const make=(accountId='a',room:RoomSnapshot['bootstrap']['room']='main'):RoomSnapshot=>({bootstrap:{accountId,room,member:null,roomState:{isOpen:true,pausedAt:null,notice:null,updatedAt:''},messages:[],reactions:[],counts:{},featureChannel:false},draft:'draft',scroll:300,pinned:false});
describe('private room snapshots',()=>{
 it('restores view state, expires without extending lifetime on access, and clears',()=>{let now=0;const cache=new ChatRoomCache('a',()=>now);cache.set('main',make());now=299999;expect(cache.get('main')?.draft).toBe('draft');now=300000;expect(cache.get('main')).toBeNull();cache.set('main',make());cache.clear();expect(cache.get('main')).toBeNull();});
 it('rejects another account and mismatched room',()=>{const cache=new ChatRoomCache('a');cache.set('main',make('b'));cache.set('main',make('a','social'));expect(cache.get('main')).toBeNull();});
 it('bounds message snapshots and excludes unfinished sends',()=>{const cache=new ChatRoomCache('a'),snapshot=make();snapshot.bootstrap.messages=Array.from({length:100},(_,i)=>({id:String(i),body:'text',guest_id:null,author_label:'A',created_at:'',pending:i===99}));cache.set('main',snapshot);expect(cache.get('main')?.bootstrap.messages).toHaveLength(80);expect(cache.get('main')?.bootstrap.messages.some(m=>m.pending)).toBe(false);});
});
