// Exercise the published SQL function against the actual current message schema.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-nested-reply-counts-db-${process.pid}.mjs`,import.meta.url);
let source=(await readFile(new URL('chat-delete-replies-database.mjs',import.meta.url),'utf8')).split('let checks=0;')[0];
source=source.replace("await db.exec(await readFile(root+'/supabase/migrations/20261001161221_chat_delete_replies.sql','utf8'));","await db.exec(await readFile(root+'/supabase/migrations/20260917020216_chat_thread_counts.sql','utf8'));\nawait db.exec(await readFile(root+'/supabase/migrations/20261001161221_chat_delete_replies.sql','utf8'));");
source+=`
for(const file of ['20261001170025_chat_notification_formatting.sql','20261001170041_chat_visible_notification_reads.sql','20261001190002_chat_shortscout_authorization.sql','20261001191605_chat_pinned_unread.sql','20261002120756_chat_member_display_names.sql','20261002140651_chat_room_message_pins.sql'])await db.exec(await readFile(root+'/supabase/migrations/'+file,'utf8'));
let checks=0;
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const post=async(body,parent=null,client=crypto.randomUUID())=>(await one("select send_chat_attachment_message($1,'main','LB member',$2,$3,'{}',$4) m",[members[1],body,parent,client])).m;
const counts=async(ids)=>(await db.query("select * from chat_thread_counts('main',$1)",[ids])).rows.map(r=>[r.message_id,Number(r.reply_count)]);
const remove=async(m)=>(await one("select change_chat_message($1,$2,'main','delete',null,$3,false,$4) m",[accounts[1],m.id,m.body,m.revision])).m;
try{
 const root=await post('root'),child=await post('child',root.id),grand=await post('grandchild',child.id),great=await post('great grandchild',grand.id);
 assert.deepEqual(Object.fromEntries(await counts([root.id,child.id,grand.id,great.id])),{[root.id]:1,[child.id]:1,[grand.id]:1,[great.id]:0});checks+=4;
 const sameClient=crypto.randomUUID(),extra=await post('idempotent child',grand.id,sameClient),retry=await post('idempotent child',grand.id,sameClient);
 assert.equal(extra.id,retry.id);assert.equal(Object.fromEntries(await counts([grand.id]))[grand.id],2);checks+=2;
 await remove(grand);assert.equal(Object.fromEntries(await counts([child.id]))[child.id],1);checks++;
 await remove(great);assert.equal(Object.fromEntries(await counts([child.id]))[child.id],1);checks++;
 await remove(extra);assert.equal(Object.fromEntries(await counts([child.id]))[child.id],0);assert.equal((await one('select removed from longboard_chat_messages where id=$1',[grand.id])).removed,true);checks+=2;
 const many=[];for(let i=0;i<100;i++){const m=await post('row '+i,root.id);many.push(m.id);if([78,79,80,99].includes(i))await post('nested '+i,m.id);}
 const result=Object.fromEntries(await counts(many));assert.equal(Object.keys(result).length,100);checks++;
 for(let i=0;i<100;i++){assert.equal(result[many[i]],[78,79,80,99].includes(i)?1:0);checks++;}
 const social=(await one("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) values($1,$1,'LB member','social','social') returning id",[members[1]])).id;
 assert.deepEqual(await counts([social]),[]);checks++;
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>counts([root.id]),/permission denied/);await db.exec('reset role');checks++;}
 console.log('PASS '+checks+' current-schema nested count assertions: direct 4-level counts, zero/one/many, 100 targets, retained tombstones and pruned removals, duplicate-send retry, room isolation and service-only grants.');
}finally{await db.close();}
`;
await writeFile(target,source);try{await import(target.href);}finally{await unlink(target);}
