import type {DirectMessage} from './chatDirectMessages';
export type DmSnapshot={messages:DirectMessage[];hasMore:boolean;draft:string;scrollTop:number};
/** Private, component-owned LRU. Reads never extend the five-minute freshness lease. */
export class ChatDmCache {
 private owner:string;private rows=new Map<string,{value:DmSnapshot;expires:number}>();
 constructor(owner:string,private readonly limit=6,private readonly ttl=300_000){this.owner=owner;}
 reset(owner:string){this.rows.clear();this.owner=owner;}
 get(owner:string,id:string,now=Date.now()):DmSnapshot|undefined{
  if(owner!==this.owner){this.reset(owner);return;}
  const row=this.rows.get(id);if(!row)return;
  this.rows.delete(id);if(row.expires<=now)return;
  this.rows.set(id,row);return {...row.value,messages:[...row.value.messages]};
 }
 put(owner:string,id:string,value:DmSnapshot,now=Date.now()){
  if(owner!==this.owner)this.reset(owner);
  this.rows.delete(id);this.rows.set(id,{value:{...value,messages:value.messages.slice(-300),hasMore:value.hasMore||value.messages.length>300},expires:now+this.ttl});
  while(this.rows.size>this.limit)this.rows.delete(this.rows.keys().next().value!);
 }
 delete(id:string){this.rows.delete(id);}
 retain(ids:Set<string>){for(const id of this.rows.keys())if(!ids.has(id))this.rows.delete(id);}
}
