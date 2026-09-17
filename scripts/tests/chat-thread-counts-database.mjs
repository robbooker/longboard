import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
try{
 await db.exec('create role anon; create role authenticated; create role service_role; create table longboard_chat_messages(id uuid primary key,room_slug text,reply_to_id uuid); grant select on longboard_chat_messages to service_role;');
 await db.exec(await readFile(new URL('../../supabase/migrations/20260917020216_chat_thread_counts.sql',import.meta.url),'utf8'));
 const ids=Array.from({length:5},(_,i)=>`00000000-0000-4000-8000-00000000000${i+1}`);
 for(const [i,room,parent]of [[0,'main',null],[1,'main',ids[0]],[2,'social',ids[0]],[3,'main',ids[1]],[4,'social',null]])await db.query('insert into longboard_chat_messages values($1,$2,$3)',[ids[i],room,parent]);
 await db.exec('set role service_role');
 const result=await db.query('select * from chat_thread_counts($1,$2)', ['main',ids]);
 assert.equal(result.rows.find(r=>r.message_id===ids[0]).reply_count,1);
 assert.equal(result.rows.find(r=>r.message_id===ids[1]).reply_count,1);
 assert.equal(result.rows.some(r=>r.message_id===ids[4]),false);
 for(const role of ['anon','authenticated']){await db.exec(`reset role; set role ${role}`);await assert.rejects(()=>db.query('select * from chat_thread_counts($1,$2)',['main',ids]),/permission denied/);}
 await db.exec('reset role');await db.query('delete from longboard_chat_messages where id=$1',[ids[1]]);
 assert.equal((await db.query('select * from chat_thread_counts($1,$2)',['main',[ids[0]]])).rows[0].reply_count,0);
 console.log('PASS direct counts, cross-room isolation, nested counts, client denial, deletion reconciliation');
}finally{await db.close();}
