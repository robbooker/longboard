import {describe,it,expect} from 'vitest';
import {quadChoices,validateQuadLayout} from '../chatQuad';
import {CHAT_DUAL_VIEW_SCRIPT,CHAT_VIEW_STORAGE_KEY,DUAL_VIEW_MEDIA} from '../chatDualView';
// #492/#493: the plain /chat page runs this before loading; it may only ever send to /chat/dual.
function run({stored,wide,search='',hash='',throws=false}:{stored:string|null;wide:boolean;search?:string;hash?:string;throws?:boolean}){
 const went:string[]=[],asked:string[]=[];
 const env={
  localStorage:{getItem:(k:string)=>{if(throws)throw new Error('blocked');return k===CHAT_VIEW_STORAGE_KEY?stored:null;}},
  matchMedia:(q:string)=>{asked.push(q);return {matches:wide};},
  location:{search,hash,replace:(u:string)=>went.push(u)},
 };
 new Function('localStorage','matchMedia','location',CHAT_DUAL_VIEW_SCRIPT)(env.localStorage,env.matchMedia,env.location);
 return {went,asked};
}
describe('Dual view',()=>{
 it('opens Dual view only when this device chose it and two chats fit',()=>{
  expect(run({stored:'dual',wide:true})).toEqual({went:['/chat/dual'],asked:[DUAL_VIEW_MEDIA]});
  expect(run({stored:'dual',wide:false}).went).toEqual([]);
  expect(run({stored:null,wide:true}).went).toEqual([]);
  expect(run({stored:'quad',wide:true}).went).toEqual([]);
 });
 it('leaves links (a notification, a room, a thread) alone, and never breaks the page',()=>{
  expect(run({stored:'dual',wide:true,search:'?dm=abc'}).went).toEqual([]);
  expect(run({stored:'dual',wide:true,hash:'#m1'}).went).toEqual([]);
  expect(run({stored:'dual',wide:true,throws:true}).went).toEqual([]);
 });
 it('keeps two panes in the saved layout',()=>{
  const options=quadChoices(['main','gainers'],[]);
  expect(validateQuadLayout(['room:gainers','room:main','room:main'],options,2)).toEqual(['room:gainers','room:main']);
  expect(validateQuadLayout(['room:main','room:main'],options,2)).toEqual(['room:main','']);
  expect(validateQuadLayout(null,options,2)).toEqual(['','']);
 });
});
