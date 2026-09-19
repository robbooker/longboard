/** A successful send may dismiss the mobile keyboard; delayed replies never steal a newer draft. */
export function beginMobileSend(composer:HTMLTextAreaElement|null,pane:HTMLElement|null,isCurrent=()=>true){
 const noop={confirmed:()=>{},cancel:()=>{}};
 if(!composer||!pane||!window.matchMedia('(max-width:1099px)').matches)return noop;
 let cancelled=false,finished=false,frame=0,timer:ReturnType<typeof setTimeout>|undefined;
 const valid=()=>!cancelled&&isCurrent()&&composer.isConnected&&pane.isConnected&&pane.getClientRects().length>0&&getComputedStyle(pane).visibility!=='hidden'&&!composer.value&&(!document.activeElement||document.activeElement===composer||!(document.activeElement instanceof HTMLInputElement||document.activeElement instanceof HTMLTextAreaElement));
 const reveal=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(valid())pane.scrollTop=pane.scrollHeight;});};
 const cleanup=()=>{composer.removeEventListener('input',cancel);pane.removeEventListener('wheel',cancel);pane.removeEventListener('touchmove',cancel);window.visualViewport?.removeEventListener('resize',reveal);window.removeEventListener('resize',reveal);if(timer)clearTimeout(timer);};
 const cancel=()=>{cancelled=true;cancelAnimationFrame(frame);cleanup();};
 composer.addEventListener('input',cancel);pane.addEventListener('wheel',cancel,{passive:true});pane.addEventListener('touchmove',cancel,{passive:true});
 timer=setTimeout(cancel,45000);
 // Preserve S03's immediate optimistic acknowledgement without dismissing a keyboard on failure.
 reveal();
 return {cancel,confirmed:()=>{if(finished)return;finished=true;if(!valid()){cancel();return;}if(timer)clearTimeout(timer);if(document.activeElement===composer)composer.blur();reveal();window.visualViewport?.addEventListener('resize',reveal);window.addEventListener('resize',reveal);timer=setTimeout(cleanup,1000);}};
}
/** Visual viewport follows the keyboard; dvh alone does not on several mobile browsers. */
export function watchChatViewport(node:HTMLElement){
 const media=window.matchMedia('(max-width:1099px)');
 const update=()=>{const viewport=window.visualViewport;if(media.matches&&viewport&&viewport.scale===1){node.style.setProperty('--chat-visual-height',`${viewport.height}px`);}else node.style.removeProperty('--chat-visual-height');};
 update();window.visualViewport?.addEventListener('resize',update);window.addEventListener('resize',update);
 return()=>{window.visualViewport?.removeEventListener('resize',update);window.removeEventListener('resize',update);node.style.removeProperty('--chat-visual-height');};
}
