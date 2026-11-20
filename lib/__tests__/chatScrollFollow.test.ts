import {expect,it} from 'vitest';
import {chatPaneAtBottom,chatPaneFollowingScroll,chatPaneHeldIntent,chatPaneScrollIntent,chatPaneWheelIntent,chatScrollKey} from '../chatScrollFollow';
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

it('#478: a wheel whose scroll already landed (passive listener) still reads as the reader moving',()=>{
 // Each wheel event is handled after its own scroll: the pane is at 775 when the wheel that moved it from 800 arrives.
 const first=chatPaneFollowingScroll(node(800),true,chatPaneScrollIntent(node(800)));
 const wheel=chatPaneWheelIntent(node(775),first.intent,-25);expect(wheel.top).toBe(800);
 expect(chatPaneFollowingScroll(node(775),true,wheel)).toMatchObject({following:false,direction:'up'});
 // Taking the intent from the pane as it is now (the old way) saw no movement and kept following.
 expect(chatPaneFollowingScroll(node(775),true,chatPaneScrollIntent(node(775)))).toMatchObject({following:true,direction:null});
 // A fresh wheel (no live intent, or it expired) starts a pixel back against its own direction, so
 // its scroll reads as movement whether or not it has landed yet.
 for(const previous of [null,{...chatPaneScrollIntent(node(800)),expires:0}]){
  const up=chatPaneWheelIntent(node(775),previous,-25);expect(up.top).toBe(776);
  expect(chatPaneFollowingScroll(node(775),true,up)).toMatchObject({following:false,direction:'up'});
  expect(chatPaneFollowingScroll(node(750),true,up)).toMatchObject({following:false,direction:'up'});
  expect(chatPaneWheelIntent(node(775),previous,25).top).toBe(774);
 }
 // A list that changed size: the old position means nothing; start a pixel back from here.
 expect(chatPaneWheelIntent(node(775,1100),chatPaneScrollIntent(node(800)),-25).top).toBe(776);
 // A wheel ends a held touch or scrollbar gesture.
 expect(chatPaneWheelIntent(node(775),chatPaneScrollIntent(node(800),'touch'),-25).gesture).toBeUndefined();
});
