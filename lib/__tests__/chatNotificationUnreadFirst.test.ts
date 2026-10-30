import {describe,expect,it} from 'vitest';
import {emptyChatActivity,type ChatActivity} from '@/lib/chatActivity';
import {holdUnreadNotifications,noHeldNotifications,orderedChatNotifications,unreadFirstNotifications} from '@/lib/chatNotificationOrder';
// D-327: unread at the top, read below, each group in today's order; a row read while the list is open holds its place.
const mention=(id:string,minute:number,read=false):ChatActivity['mentions'][number]=>({id,createdAt:`2026-10-02T12:${String(minute).padStart(2,'0')}:00Z`,read,seq:2,messageId:id,room:'main',author:'Alice',preview:id});
const dm=(id:string,minute:number,unread=1):ChatActivity['dms'][number]=>({id,createdAt:`2026-10-02T12:${String(minute).padStart(2,'0')}:00Z`,unread,throughSeq:3,pending:false,name:'Bob'});
const reaction=(id:string,minute:number,read=false):NonNullable<ChatActivity['reactions']>[number]=>({id,createdAt:`2026-10-02T12:${String(minute).padStart(2,'0')}:00Z`,read,seq:4,kind:'room',room:'social',messageId:id,author:'Carol',emoji:'heart',preview:id});
const mixed:ChatActivity={...emptyChatActivity,
 mentions:[mention('read-newest',9,true),mention('unread-a',8),mention('read-mid',5,true),mention('unread-old',1)],
 dms:[dm('dm-unread',7,3),dm('dm-read',6,0)],
 reactions:[reaction('reaction-unread',4),reaction('reaction-read',2,true)]};
const keys=(items:{key:string}[])=>items.map(i=>i.key);
const markRead=(data:ChatActivity,key:string):ChatActivity=>({...data,
 mentions:data.mentions.map(n=>`mention:${n.id}`===key?{...n,read:true}:n),
 dms:data.dms.map(n=>`dm:${n.id}`===key?{...n,unread:0}:n),
 reactions:(data.reactions??[]).map(n=>`reaction:${n.id}`===key?{...n,read:true}:n)});
describe('unreadFirstNotifications',()=>{
 it('puts every unread row above every read row, both groups in chronological order',()=>{
  expect(keys(unreadFirstNotifications(orderedChatNotifications(mixed)))).toEqual([
   'mention:unread-a','dm:dm-unread','reaction:reaction-unread','mention:unread-old',
   'mention:read-newest','dm:dm-read','mention:read-mid','reaction:reaction-read']);
 });
 it('leaves an all-read or all-unread list exactly as today',()=>{
  const allRead={...mixed,mentions:mixed.mentions.map(n=>({...n,read:true})),dms:mixed.dms.map(n=>({...n,unread:0})),reactions:mixed.reactions!.map(n=>({...n,read:true}))};
  expect(keys(unreadFirstNotifications(orderedChatNotifications(allRead)))).toEqual(keys(orderedChatNotifications(allRead)));
  const allUnread={...mixed,mentions:mixed.mentions.map(n=>({...n,read:false})),dms:mixed.dms.map(n=>({...n,unread:1})),reactions:mixed.reactions!.map(n=>({...n,read:false}))};
  expect(keys(unreadFirstNotifications(orderedChatNotifications(allUnread)))).toEqual(keys(orderedChatNotifications(allUnread)));
  expect(unreadFirstNotifications([])).toEqual([]);
 });
 it('treats a missing read flag as unread, like the bell highlight does, and does not mutate its input',()=>{
  const legacy={...emptyChatActivity,mentions:[{...mention('flagless',1),read:undefined},mention('read',2,true)]};
  const items=orderedChatNotifications(legacy);const copy=[...items];Object.freeze(items);
  expect(keys(unreadFirstNotifications(items))).toEqual(['mention:flagless','mention:read']);expect(items).toEqual(copy);
 });
});
describe('frozen while open (holdUnreadNotifications)',()=>{
 it('keeps a row read while the list is open in its place, then moves it to its read place on the next open',()=>{
  // Open: snapshot the unread rows.
  let held=holdUnreadNotifications(orderedChatNotifications(mixed),noHeldNotifications);
  const shown=keys(unreadFirstNotifications(orderedChatNotifications(mixed),held));
  // Open it / mark as read without opening: same data change either way.
  let data=markRead(mixed,'mention:unread-a');data=markRead(data,'dm:dm-unread');
  held=holdUnreadNotifications(orderedChatNotifications(data),held);
  expect(keys(unreadFirstNotifications(orderedChatNotifications(data),held))).toEqual(shown);
  // Mark all as read: still frozen while open.
  const allRead={...data,mentions:data.mentions.map(n=>({...n,read:true})),dms:data.dms.map(n=>({...n,unread:0})),reactions:data.reactions!.map(n=>({...n,read:true}))};
  expect(keys(unreadFirstNotifications(orderedChatNotifications(allRead),holdUnreadNotifications(orderedChatNotifications(allRead),held)))).toEqual(shown);
  // Leave and come back: a fresh hold, so the read rows return to their chronological read places.
  const reopened=holdUnreadNotifications(orderedChatNotifications(data),noHeldNotifications);
  expect(keys(unreadFirstNotifications(orderedChatNotifications(data),reopened))).toEqual([
   'reaction:reaction-unread','mention:unread-old',
   'mention:read-newest','mention:unread-a','dm:dm-unread','dm:dm-read','mention:read-mid','reaction:reaction-read']);
 });
 it('returns the same set when nothing new is unread, and adds rows that arrive unread while open',()=>{
  const items=orderedChatNotifications(mixed);const held=holdUnreadNotifications(items);
  expect([...held].sort()).toEqual(['dm:dm-unread','mention:unread-a','mention:unread-old','reaction:reaction-unread']);
  expect(holdUnreadNotifications(items,held)).toBe(held);
  const arrived={...mixed,mentions:[mention('arrived',10),...mixed.mentions]};
  const next=holdUnreadNotifications(orderedChatNotifications(arrived),held);
  expect(next).not.toBe(held);expect(next.has('mention:arrived')).toBe(true);expect(held.has('mention:arrived')).toBe(false);
  expect(keys(unreadFirstNotifications(orderedChatNotifications(arrived),next))[0]).toBe('mention:arrived');
 });
 it('lists loading after the panel opens are still captured (lists arrive empty first)',()=>{
  let held=holdUnreadNotifications(orderedChatNotifications(emptyChatActivity));
  expect(held).toBe(noHeldNotifications);
  held=holdUnreadNotifications(orderedChatNotifications(mixed),held);
  expect(held.size).toBe(4);
 });
});
