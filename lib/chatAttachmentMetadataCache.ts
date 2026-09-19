import type {ChatAttachment} from './chatAttachmentValidation';
export type AttachmentScope={room:string}|{conversationId:string};
export const attachmentScopeKey=(scope:AttachmentScope)=>'room' in scope?`room:${scope.room}`:`dm:${scope.conversationId}`;
type Waiting={ids:string[];resolve:(files:ChatAttachment[])=>void;reject:(error:Error)=>void};
/** Owned by one authenticated shell. No process-global or persistent private cache. */
export class AttachmentMetadataCache{
 private epoch=0;private scopes=new Set<string>();
 private versions=new Map<string,number>();
 private values=new Map<string,{file:ChatAttachment;expires:number}>();private queues=new Map<string,{scope:AttachmentScope;waiters:Waiting[]}>();private timer:ReturnType<typeof setTimeout>|undefined;private controllers=new Set<AbortController>();private closed=false;
 constructor(private fetcher:typeof fetch=fetch,private onUnavailable:(scope:string)=>void=()=>{},private ttl=30_000,private limit=300){}
 invalidate(scope:AttachmentScope){const key=attachmentScopeKey(scope);this.versions.set(key,(this.versions.get(key)??0)+1);for(const id of this.values.keys())if(id.startsWith(key+'|'))this.values.delete(id);this.onUnavailable(key);}
 invalidateAll(){this.epoch++;this.values.clear();for(const scope of this.scopes)this.onUnavailable(scope);}
 read(scope:AttachmentScope,ids:string[]):Promise<ChatAttachment[]>{
  if(this.closed)return Promise.reject(Error('Attachment session ended.'));
  const key=attachmentScopeKey(scope),now=Date.now();this.scopes.add(key);const hits=ids.map(id=>this.values.get(key+'|'+id));
  if(hits.every(row=>row&&row.expires>now))return Promise.resolve(hits.map(row=>row!.file));
  return new Promise((resolve,reject)=>{const group=this.queues.get(key)??{scope,waiters:[]};group.waiters.push({ids,resolve,reject});this.queues.set(key,group);this.timer??=setTimeout(()=>void this.flush(),20);});
 }
 private async flush(){
  this.timer=undefined;const groups=[...this.queues.entries()];this.queues.clear();
  await Promise.all(groups.map(async([key,{scope,waiters}])=>{
   const epoch=this.epoch,revision=this.versions.get(key)??0;const ids=[...new Set(waiters.flatMap(w=>w.ids))];const files=new Map<string,ChatAttachment>();const controller=new AbortController();this.controllers.add(controller);
   try{
    for(let offset=0;offset<ids.length;offset+=60){
     const params=new URLSearchParams({...scope,ids:ids.slice(offset,offset+60).join(',')});
     const fetcher=this.fetcher;const response=await fetcher(`/api/chat/attachments?${params}`,{cache:'no-store',signal:controller.signal});
     if(!response.ok){if(response.status===401)this.invalidateAll();else this.invalidate(scope);throw Error('Attachments unavailable. Retry to check access.');}
     const data=await response.json();if(this.closed||epoch!==this.epoch||(this.versions.get(key)??0)!==revision)throw Error('Attachment session ended or access changed.');
     for(const file of data.files as ChatAttachment[])if(ids.includes(file.id)){files.set(file.id,file);this.values.delete(key+'|'+file.id);this.values.set(key+'|'+file.id,{file,expires:Date.now()+this.ttl});}
     while(this.values.size>this.limit)this.values.delete(this.values.keys().next().value!);
    }
    for(const id of ids)if(!files.has(id))this.values.delete(key+'|'+id);
    for(const waiter of waiters)waiter.resolve(waiter.ids.flatMap(id=>files.has(id)?[files.get(id)!]:[]));
   }catch(error){for(const waiter of waiters)waiter.reject(error instanceof Error?error:Error('Attachments unavailable.'));}
   finally{this.controllers.delete(controller);}
  }));
 }
 dispose(){this.closed=true;clearTimeout(this.timer);for(const controller of this.controllers)controller.abort();for(const group of this.queues.values())for(const waiter of group.waiters)waiter.reject(Error('Attachment session ended.'));this.queues.clear();this.values.clear();}
}
