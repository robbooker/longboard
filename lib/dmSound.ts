import type {DirectConversation} from './chatDirectMessages';
export type DmTone='chime'|'pulse';
export type DmChoice=DmTone|'default'|'mute';
export type DmSoundPreferences={enabled:boolean;defaultTone:DmTone;conversations:Record<string,DmChoice>};
export const defaultDmSounds=():DmSoundPreferences=>({enabled:false,defaultTone:'chime',conversations:{}});
export const isDmChoice=(value:unknown):value is DmChoice=>['default','mute','chime','pulse'].includes(value as string);
export function parseDmSounds(raw:string|null):DmSoundPreferences {
 try {const p=JSON.parse(raw??'null');if(!p||typeof p!=='object')return defaultDmSounds();
 return {enabled:p.enabled===true,defaultTone:p.defaultTone==='pulse'?'pulse':'chime',conversations:Object.fromEntries(Object.entries(p.conversations??{}).filter((entry):entry is [string,DmChoice]=>/^[a-f0-9-]{36}$/i.test(entry[0])&&isDmChoice(entry[1])))};
 }catch{return defaultDmSounds();}
}
export function dmTone(preferences:DmSoundPreferences,id:string):DmTone|null {
 const choice=preferences.conversations[id]??'default';return !preferences.enabled||choice==='mute'?null:choice==='default'?preferences.defaultTone:choice;
}
/** The first authorized snapshot is history. Always advance, including while muted. */
export class DmSoundTracker {
 private initialized=false;
 private seen=new Map<string,{seq:number;available:boolean}>();
 observe(rows:DirectConversation[]):string[]{
  const fresh:string[]=[];
  for(const row of rows){
   const seq=Number.isSafeInteger(row.latestIncomingSeq)?row.latestIncomingSeq!:0;
   const available=!row.system&&!row.unavailable&&!row.blockedByMe&&row.status!=='declined';
   const previous=this.seen.get(row.id);
   if(this.initialized&&available&&previous?.available!==false&&seq>0&&seq>(previous?.seq??0))fresh.push(row.id);
   this.seen.set(row.id,{seq:Math.max(seq,previous?.seq??0),available});
  }
  this.initialized=true;return fresh;
 }
}
