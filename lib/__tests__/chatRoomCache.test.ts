import {describe,it,expect} from 'vitest';
import {ChatRoomCache,type RoomSnapshot} from '../chatRoomCache';
const make=(accountId='a',room:RoomSnapshot['bootstrap']['room']='main'):RoomSnapshot=>({bootstrap:{accountId,room,member:null,roomState:{isOpen:true,pausedAt:null,notice:null,updatedAt:''},messages:[],reactions:[],counts:{},featureChannel:false},draft:'draft',scroll:300,pinned:false});
describe('private room snapshots',()=>{
 it('restores view state, expires without extending lifetime on access, and clears',()=>{let now=0;const cache=new ChatRoomCache('a',()=>now);cache.set('main',make());now=299999;expect(cache.get('main')?.draft).toBe('draft');now=300000;expect(cache.get('main')).toBeNull();cache.set('main',make());cache.clear();expect(cache.get('main')).toBeNull();});
 it('rejects another account and mismatched room',()=>{const cache=new ChatRoomCache('a');cache.set('main',make('b'));cache.set('main',make('a','social'));expect(cache.get('main')).toBeNull();});
 it('bounds message snapshots and excludes unfinished sends',()=>{const cache=new ChatRoomCache('a'),snapshot=make();snapshot.bootstrap.messages=Array.from({length:100},(_,i)=>({id:String(i),body:'text',guest_id:null,author_label:'A',created_at:'',pending:i===99}));cache.set('main',snapshot);expect(cache.get('main')?.bootstrap.messages).toHaveLength(80);expect(cache.get('main')?.bootstrap.messages.some(m=>m.pending)).toBe(false);});
});
it('updates restored names monotonically while preserving drafts, uploads references and scroll',()=>{
 const cache=new ChatRoomCache('a'),snapshot=make(),member={id:'m',display_name:'Old',accepts_requests:true,name_revision:0};snapshot.bootstrap.member=member;snapshot.bootstrap.messages=[{id:'msg',guest_id:'m',member_id:'m',author_label:'Old',body:'@Old stays',created_at:'',attachment_ids:['file']}];snapshot.replyDrafts={msg:{body:'unsent',scroll:12}};cache.set('main',snapshot);
 cache.renameMember({...member,display_name:'New',name_revision:2});cache.renameMember({...member,display_name:'Stale',name_revision:1});const restored=cache.get('main')!;
 expect(restored.bootstrap.member?.display_name).toBe('New');expect(restored.bootstrap.messages[0]).toMatchObject({author_label:'New',body:'@Old stays',attachment_ids:['file']});expect(restored.draft).toBe('draft');expect(restored.scroll).toBe(300);expect(restored.replyDrafts).toEqual(snapshot.replyDrafts);
});
