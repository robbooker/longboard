/** A deliberate downward gesture; tiny movement remains a tap, not a swipe. */
export function isKeyboardDismissSwipe(x:number,y:number){return y>=40&&y>Math.abs(x)*1.5;}
export function isKeyboardDismissTap(distance:number,elapsed:number){return distance<=10&&elapsed<=500;}

/** Observe native touch without claiming scrolling, clicks, selection, or overscroll. */
export function watchChatKeyboardDismiss(root:HTMLElement){
 type Gesture={input:HTMLTextAreaElement;id:number;x:number;y:number;started:number;distance:number};
 let gesture:Gesture|null=null;
 const interactive='form,button,a,input,textarea,select,label,summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="option"],[role="listbox"],audio,video,iframe';
 const selection=()=>window.getSelection()?.isCollapsed===false;
 const modal=()=>Array.from(document.querySelectorAll('dialog[open],[role="dialog"][aria-modal="true"]')).some(node=>node.getClientRects().length>0);
 const valid=(input:HTMLTextAreaElement)=>document.activeElement===input&&root.contains(input)&&input.isConnected&&!document.hidden&&root.getClientRects().length>0&&!modal()&&!selection();
 const reset=()=>{gesture=null;};
 const start=(event:TouchEvent)=>{
  reset();
  const input=document.activeElement,target=event.target;
  if(event.touches.length!==1||!(input instanceof HTMLTextAreaElement)||!input.hasAttribute('data-chat-composer')||!(target instanceof Element)||target.closest(interactive)||!valid(input))return;
  const touch=event.touches[0];
  gesture={input,id:touch.identifier,x:touch.clientX,y:touch.clientY,started:event.timeStamp,distance:0};
 };
 const move=(event:TouchEvent)=>{
  if(!gesture)return;
  const touch=Array.from(event.touches).find(touch=>touch.identifier===gesture?.id);
  if(event.touches.length!==1||!touch||!valid(gesture.input)){reset();return;}
  const x=touch.clientX-gesture.x,y=touch.clientY-gesture.y;
  gesture.distance=Math.max(gesture.distance,Math.hypot(x,y));
  if(isKeyboardDismissSwipe(x,y)){const input=gesture.input;reset();input.blur();}
 };
 const end=(event:TouchEvent)=>{
  const current=gesture;reset();
  if(!current||event.touches.length||!valid(current.input))return;
  const touch=Array.from(event.changedTouches).find(touch=>touch.identifier===current.id);
  if(!touch)return;
  const distance=Math.max(current.distance,Math.hypot(touch.clientX-current.x,touch.clientY-current.y));
  if(isKeyboardDismissTap(distance,event.timeStamp-current.started))current.input.blur();
 };
 const options={capture:true,passive:true};
 root.addEventListener('touchstart',start,options);root.addEventListener('touchmove',move,options);root.addEventListener('touchend',end,options);root.addEventListener('touchcancel',reset,options);
 return()=>{reset();root.removeEventListener('touchstart',start,true);root.removeEventListener('touchmove',move,true);root.removeEventListener('touchend',end,true);root.removeEventListener('touchcancel',reset,true);};
}
