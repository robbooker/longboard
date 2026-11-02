import {expect,it} from 'vitest';
import {chatPaneAtBottom,chatPaneFollowingScroll,chatPaneHeldIntent,chatPaneScrollIntent,chatScrollKey} from '../chatScrollFollow';
const node=(top=800,height=1000,viewport=200)=>({scrollTop:top,scrollHeight:height,clientHeight:viewport} as HTMLElement);
it('preserves following for a touch, click or downward wheel with no movement',()=>{
 const pane=node();expect(chatPaneFollowingScroll(pane,true,chatPaneScrollIntent(pane))).toMatchObject({following:true,direction:null});
 expect(chatPaneFollowingScroll(pane,false,chatPaneScrollIntent(pane))).toMatchObject({following:false,direction:null});
});
it('pauses genuine upward movement even within the near-bottom band',()=>{
 for(const top of [780,799])expect(chatPaneFollowingScroll(node(top),true,chatPaneScrollIntent(node()))).toMatchObject({following:false,direction:'up'});
});
it('resumes only on a downward return within 48px, retaining exact-bottom read geometry',()=>{
 const before=chatPaneScrollIntent(node(500));
 expect(chatPaneFollowingScroll(node(751),false,before).following).toBe(false);
 expect(chatPaneFollowingScroll(node(752),false,before)).toMatchObject({following:true,direction:'down'});
 expect(chatPaneAtBottom(node(752))).toBe(false);expect(chatPaneAtBottom(node(798))).toBe(true);
});
it('ignores scroll events without manual intent and layout-generated changes',()=>{
 expect(chatPaneFollowingScroll(node(800),false,null).following).toBe(false);
 expect(chatPaneFollowingScroll(node(800),false,{...chatPaneScrollIntent(node(500)),expires:0})).toEqual({following:false,intent:null,direction:null});
 expect(chatPaneFollowingScroll(node(1000,1200),false,chatPaneScrollIntent(node(500)))).toEqual({following:false,intent:null,direction:null});
 expect(chatPaneFollowingScroll(node(800,1000,100),true,chatPaneScrollIntent(node()))).toEqual({following:true,intent:null,direction:null});
});
it('keeps intent across incremental manual/inertial motion and clears it for automatic writes',()=>{
 const up=chatPaneFollowingScroll(node(700),true,chatPaneScrollIntent(node()));
 const more=chatPaneFollowingScroll(node(600),up.following,up.intent);expect(more.following).toBe(false);
 const down=chatPaneFollowingScroll(node(770),more.following,more.intent);expect(down.following).toBe(true);
 expect(chatPaneFollowingScroll(node(800),true,null).direction).toBeNull();
});
it('only considers native scrolling keys, not typing or focus traversal',()=>{
 for(const key of ['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '])expect(chatScrollKey(key,null)).toBe(true);
 for(const key of ['a','Enter','Tab','Escape'])expect(chatScrollKey(key,null)).toBe(false);
});

it('keeps a held gesture alive beyond idle expiry, then expires after release',()=>{
 const intent={...chatPaneScrollIntent(node(),'pointer'),expires:0};
 const moved=chatPaneFollowingScroll(node(600),true,intent);expect(moved.following).toBe(false);expect(moved.intent?.gesture).toBe(intent.gesture);
 intent.gesture!.until=0;
 expect(chatPaneFollowingScroll(node(800),false,intent)).toEqual({following:false,intent:null,direction:null});
});

it('a message arriving during a held gesture does not end it, so the drag still pauses following',()=>{
 const intent=chatPaneScrollIntent(node(),'pointer');
 // The list grew and the room kept the bottom in view: no direction yet, following unchanged.
 const grown=chatPaneFollowingScroll(node(860,1060),true,intent);expect(grown).toMatchObject({following:true,direction:null});expect(grown.intent?.gesture).toBe(intent.gesture);
 expect(chatPaneFollowingScroll(node(700,1060),true,grown.intent)).toMatchObject({following:false,direction:'up'});
 // Moving to the bottom keeps a held gesture too; a released or wheel intent still ends.
 const kept=chatPaneHeldIntent(intent,node(860,1060));expect(kept?.top).toBe(860);expect(kept?.height).toBe(1060);expect(kept?.gesture).toBe(intent.gesture);
 expect(chatPaneHeldIntent(chatPaneScrollIntent(node()),node(860,1060))).toBeNull();
 expect(chatPaneHeldIntent(null,node())).toBeNull();
 intent.gesture!.until=Date.now()+1000;
 expect(chatPaneHeldIntent(intent,node())).toBeNull();
 expect(chatPaneFollowingScroll(node(700,1060),true,intent)).toEqual({following:true,intent:null,direction:null});
});
