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
const people=[];for(const name of ['Alice','Bob','Eve']){const user=randomUUID(),member=randomUUID();people.push({user,member});await q('insert into profiles values($1,\'user\')',[user]);await q('insert into chat_accounts values($1,$1)',[user]);await q('insert into longboard_chat_members values($1,$2,$3)',[member,user,name]);}
const [a,b,e]=people,dm=randomUUID();await q("insert into longboard_chat_conversations values($1,$2,$3,'accepted')",[dm,a.member,b.member]);await q("insert into user_tags values($1,'boardroom-cohort-1')",[a.user]);
await db.exec('set role service_role');
const act=async(user,action='get',room=null,conversation=null)=>(await q('select chat_favorite($1,$2,$3,$4) as favorite',[user,action,room,conversation]))[0].favorite;
assert.equal(await act(a.user),null);assert.equal((await act(a.user,'set','main')).room,'main');assert.equal(await act(b.user),null);
await assert.rejects(()=>act(b.user,'set','main'),/favorite_unavailable/);
assert.equal((await act(a.user,'set',null,dm)).label,'Bob');assert.equal((await act(a.user)).conversationId,dm);assert.equal((await q('select count(*)::integer as n from chat_favorites'))[0].n,1);
assert.equal((await act(b.user,'set',null,dm)).label,'Alice');await assert.rejects(()=>act(e.user,'set',null,dm),/favorite_unavailable/);
for(const [blocker,blocked] of [[a.member,b.member],[b.member,a.member]]){await q('insert into longboard_chat_blocks values($1,$2)',[blocker,blocked]);assert.equal(await act(a.user),null);await assert.rejects(()=>act(a.user,'set',null,dm),/favorite_unavailable/);await q('delete from longboard_chat_blocks');}
for(const status of ['pending','declined']){await q('update longboard_chat_conversations set status=$1',[status]);assert.equal(await act(a.user),null);await assert.rejects(()=>act(a.user,'set',null,dm),/favorite_unavailable/);}
await q("update longboard_chat_conversations set status='accepted'");await q('delete from profiles where id=$1',[b.user]);assert.equal(await act(a.user),null);await assert.rejects(()=>act(a.user,'set',null,dm),/favorite_unavailable/);
await act(a.user,'set','main');await q('delete from user_tags where user_id=$1',[a.user]);assert.equal(await act(a.user),null);await assert.rejects(()=>act(a.user,'set','main'),/favorite_unavailable/);
await act(a.user,'set','social');assert.equal((await act(a.user)).room,'social');await act(a.user,'clear');assert.equal(await act(a.user),null);assert.equal((await q('select count(*)::integer as n from chat_favorites where account_id=$1',[a.user]))[0].n,0);
await assert.rejects(()=>act(randomUUID()),/member_required/);
for(const role of ['anon','authenticated']){await db.exec('reset role;set role '+role);await assert.rejects(()=>act(a.user),/permission denied/);await assert.rejects(()=>q('select * from chat_favorites'),/permission denied/);await assert.rejects(()=>q('select chat_favorite_target($1,$2,$3)',[a.user,'social',null]),/permission denied/);}
await db.close();console.log('PASS favorites SQL: single persistent selection, account isolation, room entitlements, accepted participant DMs, both blocks, revoked access, clearing and grants.');
