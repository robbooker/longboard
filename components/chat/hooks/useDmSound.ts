'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {defaultDmSounds,dmTone,DmSoundTracker,parseDmSounds,type DmSoundPreferences,type DmTone} from '@/lib/dmSound';
import type {DirectConversation} from '@/lib/chatDirectMessages';
export function useDmSound(memberId:string,enabled=true){
 const key=`longboard-dm-sounds-v1:${memberId}`;
 const [preferences,setPreferences]=useState(defaultDmSounds);
 const prefs=useRef(preferences),tracker=useRef(new DmSoundTracker()),audio=useRef<AudioContext|null>(null);
 const [message,setMessage]=useState('');
 const unlock=useCallback(async()=>{if(!prefs.current.enabled)return;try{
  const context=audio.current??(audio.current=new AudioContext());if(context.state==='suspended')await context.resume();
  if(context.state!=='running')setMessage('Use Test DM sound to allow audio in this browser.');
 }catch{setMessage('Audio is unavailable in this browser. Unread badges still work.');}},[]);
 const play=useCallback((tone:DmTone)=>{const context=audio.current;if(!prefs.current.enabled)return;
  if(!context||context.state!=='running'){setMessage('Use Test DM sound to allow audio in this browser.');return;}
  try{const oscillator=context.createOscillator(),gain=context.createGain(),now=context.currentTime;
   oscillator.type='sine';oscillator.frequency.setValueAtTime(tone==='chime'?660:440,now);oscillator.frequency.setValueAtTime(tone==='chime'?880:440,now+.12);
   gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.08,now+.015);gain.gain.exponentialRampToValueAtTime(.001,now+.35);
   oscillator.connect(gain);gain.connect(context.destination);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};oscillator.start();oscillator.stop(now+.37);setMessage('');
  }catch{setMessage('Sound could not play. Unread badges still work.');}
 },[]);
 useEffect(()=>{
  if(!enabled)return;
  tracker.current=new DmSoundTracker();
  const read=()=>{let next=defaultDmSounds();try{next=parseDmSounds(localStorage.getItem(key));}catch{}prefs.current=next;setPreferences(next);};read();
  const storage=(event:StorageEvent)=>{if(event.key===key||event.key===null)read();};const gesture=()=>{void unlock();};
  window.addEventListener('storage',storage);window.addEventListener('pointerdown',gesture);window.addEventListener('keydown',gesture);
  return()=>{window.removeEventListener('storage',storage);window.removeEventListener('pointerdown',gesture);window.removeEventListener('keydown',gesture);void audio.current?.close();audio.current=null;};
 },[key,unlock,enabled]);
 const save=useCallback((next:DmSoundPreferences)=>{prefs.current=next;setPreferences(next);setMessage('');try{localStorage.setItem(key,JSON.stringify(next));}catch{setMessage('This browser cannot save sound preferences after you leave.');}if(next.enabled)void unlock();else{void audio.current?.close();audio.current=null;}},[key,unlock]);
 const observe=useCallback((rows:DirectConversation[])=>{if(!enabled)return;const ids=tracker.current.observe(rows);const tones=ids.map(id=>dmTone(prefs.current,id)).filter((tone):tone is DmTone=>tone!==null);if(tones[0])play(tones[0]);},[play,enabled]);
 const test=useCallback(async(id?:string)=>{await unlock();const tone=id?dmTone(prefs.current,id):prefs.current.enabled?prefs.current.defaultTone:null;if(tone)play(tone);},[unlock,play]);
 return {preferences,message,save,test,observe};
}
