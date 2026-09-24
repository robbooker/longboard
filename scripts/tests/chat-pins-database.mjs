// Isolated database; never reads production credentials.
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();const q=async(sql,args=[]) =>(await db.query(sql,args)).rows;
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create table profiles(id uuid primary key,role text);create table chat_accounts(id uuid primary key,longboard_user_id uuid);
create table user_tags(user_id uuid,tag text);create table chat_provider_identities(account_id uuid,provider text,membership_level text,verified_at timestamptz);
create table longboard_chat_members(id uuid primary key,user_id uuid,display_name text);
create table longboard_chat_conversations(id uuid primary key,requester_id uuid,recipient_id uuid,status text);
create table longboard_chat_blocks(blocker_id uuid,blocked_id uuid);grant usage on schema public to anon,authenticated,service_role;grant all on all tables in schema public to service_role;`);
const source=await readFile(new URL('../../supabase/migrations/20260918160518_chat_admin_public_room_access.sql',import.meta.url),'utf8');await db.exec(source.slice(0,source.indexOf('-- Authoritative profile role')));
await db.exec(await readFile(new URL('../../supabase/migrations/20260919172700_chat_favorite.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../../supabase/migrations/20260924133714_chat_conversation_pins.sql',import.meta.url),'utf8'));
const people=[];for(const name of ['Alice','Bob','Eve']){const user=randomUUID(),member=randomUUID();people.push({user,member});await q('insert into profiles values($1,\'user\')',[user]);await q('insert into chat_accounts values($1,$1)',[user]);await q('insert into longboard_chat_members values($1,$2,$3)',[member,user,name]);}
const [a,b,e]=people,dm=randomUUID();await q("insert into longboard_chat_conversations values($1,$2,$3,'accepted')",[dm,a.member,b.member]);await q("insert into user_tags values($1,'boardroom-cohort-1')",[a.user]);
await db.exec('set role service_role');
const act=async(user,action='get',room=null,conversation=null)=>(await q('select chat_pins($1,$2,$3,$4) as favorite',[user,action,room,conversation]))[0].favorite;
assert.deepEqual(await act(a.user),[]);
await act(a.user,'pin','main');await act(a.user,'pin','social');await act(a.user,'pin',null,dm);
const saved=await act(a.user);assert.deepEqual(saved.map(p=>p.room||p.conversationId),['main','social',dm]);
await act(a.user,'pin','main');assert.deepEqual(await act(a.user),saved);
assert.deepEqual(await act(b.user),[]);await act(b.user,'unpin',null,dm);assert.deepEqual(await act(a.user),saved);
await assert.rejects(()=>act(b.user,'pin','main'),/pin_unavailable/);await assert.rejects(()=>act(e.user,'pin',null,dm),/pin_unavailable/);
await q("select chat_favorite($1,'set','social',null)",[a.user]);await act(a.user,'unpin','social');assert.equal((await q("select chat_favorite($1) as f",[a.user]))[0].f.room,'social');
await act(a.user,'pin','social');assert.deepEqual((await act(a.user)).map(p=>p.room||p.conversationId),['main',dm,'social']);
for(const [blocker,blocked] of [[a.member,b.member],[b.member,a.member]]){await q('insert into longboard_chat_blocks values($1,$2)',[blocker,blocked]);assert.ok(!(await act(a.user)).some(p=>p.kind==='dm'));await assert.rejects(()=>act(a.user,'pin',null,dm),/pin_unavailable/);await q('delete from longboard_chat_blocks');}
for(const status of ['pending','declined']){await q('update longboard_chat_conversations set status=$1',[status]);assert.ok(!(await act(a.user)).some(p=>p.kind==='dm'));await assert.rejects(()=>act(a.user,'pin',null,dm),/pin_unavailable/);}
await q("update longboard_chat_conversations set status='accepted'");await q('delete from profiles where id=$1',[b.user]);assert.ok(!(await act(a.user)).some(p=>p.kind==='dm'));
await q('delete from user_tags where user_id=$1',[a.user]);assert.deepEqual((await act(a.user)).map(p=>p.room),['social']);
await act(a.user,'unpin','main');await act(a.user,'unpin',null,dm);await act(a.user,'unpin','social');assert.deepEqual(await act(a.user),[]);
await assert.rejects(()=>act(randomUUID()),/member_required/);
// Fifty saved targets maximum, including hidden targets; duplicate pins stay idempotent.
await q("insert into profiles values($1,'user')",[b.user]);
for(let i=0;i<50;i++){const id=randomUUID();await q("insert into longboard_chat_conversations values($1,$2,$3,'accepted')",[id,a.member,b.member]);await act(a.user,'pin',null,id);}
await assert.rejects(()=>act(a.user,'pin','social'),/pin_limit/);
const full=await act(a.user);assert.equal(full.length,50);await act(a.user,'pin',null,full[0].conversationId);assert.deepEqual(await act(a.user),full);
await act(a.user,'unpin',null,full[0].conversationId);await act(a.user,'pin','social');assert.equal((await act(a.user)).length,50);
await q('delete from longboard_chat_conversations where id=$1',[full[1].conversationId]);assert.equal((await act(a.user)).length,49);
for(const role of ['anon','authenticated']){await db.exec('reset role;set role '+role);await assert.rejects(()=>act(a.user),/permission denied/);await assert.rejects(()=>q('select * from chat_conversation_pins'),/permission denied/);await assert.rejects(()=>q("insert into chat_conversation_pins(account_id,room_slug) values($1,'social')",[a.user]),/permission denied/);}
await db.close();console.log('PASS pins SQL: stable multiple persistent pins, idempotency, unpin/account isolation, favorite independence, entitlements, DM participants/status/blocks/revocation, deletion cascade, limit and grants.');
