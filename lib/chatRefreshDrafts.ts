export const CHAT_DRAFT_TTL = 2 * 60 * 60 * 1000;
const PREFIX = 'chat-refresh-draft:';
type Store = Pick<Storage, 'getItem'|'setItem'|'removeItem'|'key'|'length'>;
const keyFor = (owner:string, scope:string) => `${PREFIX}${encodeURIComponent(owner)}:${encodeURIComponent(scope)}`;
export function saveChatDraft(store:Store,owner:string,scope:string,text:string,now=Date.now()):boolean {
 if(!owner||!scope)return !text;
 try {
  for(let i=store.length-1;i>=0;i--){const key=store.key(i);if(!key?.startsWith(PREFIX))continue;try{const row=JSON.parse(store.getItem(key)||'null');if(!row||typeof row.at!=='number'||now-row.at>=CHAT_DRAFT_TTL)store.removeItem(key);}catch{store.removeItem(key);}}
  const key=keyFor(owner,scope);
  if(!text){store.removeItem(key);return true;}
  if(text.length>2000)return false;
  let count=0;for(let i=0;i<store.length;i++)if(store.key(i)?.startsWith(PREFIX))count++;
  if(count>=100&&!store.getItem(key))return false;
  store.setItem(key,JSON.stringify({at:now,text}));
  return true;
 }catch{return false;}
}
export function readChatDraft(store:Store,owner:string,scope:string,now=Date.now()):string {
 if(!owner||!scope)return '';
 try{const key=keyFor(owner,scope),row=JSON.parse(store.getItem(key)||'null');if(!row)return '';if(typeof row.text!=='string'||row.text.length>2000||typeof row.at!=='number'||now-row.at>=CHAT_DRAFT_TTL||row.at>now){store.removeItem(key);return '';}return row.text;}catch{return '';}
}
export function clearChatDrafts(store:Store){try{for(let i=store.length-1;i>=0;i--){const key=store.key(i);if(key?.startsWith(PREFIX))store.removeItem(key);}}catch{/* Storage can be disabled. */}}
