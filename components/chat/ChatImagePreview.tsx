'use client';

import Image from 'next/image';
import {createPortal} from 'react-dom';
import {useEffect,useId,useRef,useState,type KeyboardEvent} from 'react';
import styles from './ChatImagePreview.module.css';

/** URLs remain owned by the caller's authenticated room/DM attachment routes. */
export default function ChatImagePreview({src,thumbnailSrc,previewWidth,previewHeight,alt,downloadHref}:{src:string;thumbnailSrc?:string;previewWidth?:number|null;previewHeight?:number|null;alt:string;downloadHref:string}){
 const ratio=previewWidth&&previewHeight?previewWidth/previewHeight:320/220;
 const frameWidth=Math.min(320,previewWidth??320,220*ratio);
 const [thumbnailFailed,setThumbnailFailed]=useState(!thumbnailSrc);
 useEffect(()=>setThumbnailFailed(!thumbnailSrc),[thumbnailSrc]);
 const [open,setOpen]=useState(false),[failed,setFailed]=useState(false),[loading,setLoading]=useState(true);
 const trigger=useRef<HTMLButtonElement>(null),dialog=useRef<HTMLDialogElement>(null),close=useRef<HTMLButtonElement>(null);
 const titleId=useId();
 useEffect(()=>{
  if(!open)return;
  const modal=dialog.current!,originalOverflow=document.body.style.overflow;
  document.body.style.overflow='hidden';modal.showModal();close.current?.focus();
  const opener=trigger.current;
  return()=>{modal.close();document.body.style.overflow=originalOverflow;if(opener?.isConnected)opener.focus({preventScroll:true});};
 },[open]);
 const keyboard=(event:KeyboardEvent<HTMLDialogElement>)=>{
  // A preview inside a reply/DM portal must not trigger the underlying chat keys.
  event.stopPropagation();
  if(event.key==='Escape'){event.preventDefault();setOpen(false);return;}
  if(event.key==='Tab'){
   const controls=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]')??[]),first=controls[0],last=controls.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
 };
 return <>
  <button ref={trigger} type='button' className={styles.thumbnail} style={{width:"100%",maxWidth:frameWidth,aspectRatio:ratio,height:'auto'}} aria-label={`Enlarge ${alt}`} aria-haspopup='dialog' onClick={()=>{setFailed(false);setLoading(true);setOpen(true);}}>
   {thumbnailFailed||!thumbnailSrc?<span>Preview unavailable · Open original</span>:<Image unoptimized src={thumbnailSrc} alt={alt} width={previewWidth??320} height={previewHeight??220} loading='lazy' onError={()=>setThumbnailFailed(true)}/>}
  </button>
  {open&&createPortal(<dialog ref={dialog} className={styles.dialog} aria-modal='true' aria-labelledby={titleId} onKeyDown={keyboard} onCancel={event=>{event.preventDefault();event.stopPropagation();setOpen(false);}} onClose={()=>setOpen(false)} onClick={event=>{if(event.target===event.currentTarget)setOpen(false);}}>
   <section className={styles.panel}>
    <header className={styles.header}><h2 id={titleId}>{alt}</h2><button ref={close} type='button' onClick={()=>setOpen(false)} aria-label='Close image preview'>×</button></header>
    <div className={styles.imageArea} aria-busy={loading}>
     {failed?<p role='alert'>This image could not load. Try opening it again or download the file below.</p>:<Image className={styles.image} unoptimized src={src} alt={alt} width={1600} height={1200} onLoad={()=>setLoading(false)} onError={()=>{setLoading(false);setFailed(true);}}/>}
     {loading&&<span className={styles.loading} role='status'>Loading image…</span>}
    </div>
    <footer className={styles.footer}><a href={downloadHref} target='_blank' rel='noopener noreferrer'>Download original</a></footer>
   </section>
  </dialog>,document.body)}
 </>;
}
