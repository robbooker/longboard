'use client';
import {useCallback,useRef,type KeyboardEvent,type SyntheticEvent} from 'react';

type OpenMenus={menus:Set<HTMLDetailsElement>;outside:(event:PointerEvent)=>void};
const documents=new WeakMap<Document,OpenMenus>();

function unregister(menu:HTMLDetailsElement){
 const doc=menu.ownerDocument,entry=documents.get(doc);
 if(!entry)return;
 entry.menus.delete(menu);
 if(!entry.menus.size){doc.removeEventListener('pointerdown',entry.outside,true);documents.delete(doc);}
}
function register(menu:HTMLDetailsElement){
 const doc=menu.ownerDocument;
 let entry=documents.get(doc);
 if(!entry){
  entry={menus:new Set(),outside:event=>{
   const path=event.composedPath();
   for(const openMenu of [...(documents.get(doc)?.menus??[])]){
    if(!openMenu.isConnected||!openMenu.open){unregister(openMenu);continue;}
    if(!path.includes(openMenu)){openMenu.open=false;unregister(openMenu);}
   }
  }};
  documents.set(doc,entry);
  doc.addEventListener('pointerdown',entry.outside,true);
 }
 entry.menus.add(menu);
}

/** Native disclosures share one outside listener per document, only while open. */
export function useMessageActionMenu(){
 const current=useRef<HTMLDetailsElement|null>(null);
 const menuRef=useCallback((node:HTMLDetailsElement|null)=>{
  if(current.current)unregister(current.current);
  current.current=node;
  if(node?.open)register(node);
 },[]);
 const closeMenu=useCallback(()=>{
  const menu=current.current;if(!menu)return;
  menu.open=false;unregister(menu);
 },[]);
 const onToggle=useCallback((event:SyntheticEvent<HTMLDetailsElement>)=>{
  const menu=event.currentTarget;
  // A queued native toggle must not register a detached or replaced row.
  if(menu===current.current&&menu.isConnected&&menu.open)register(menu);
  else unregister(menu);
 },[]);
 const onKeyDown=useCallback((event:KeyboardEvent<HTMLDetailsElement>)=>{
  if(event.key!=='Escape'||!event.currentTarget.open)return;
  event.preventDefault();event.stopPropagation();
  closeMenu();current.current?.querySelector('summary')?.focus({preventScroll:true});
 },[closeMenu]);
 return {menuRef,onToggle,onKeyDown,closeMenu};
}
