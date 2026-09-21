// Isolated PostgreSQL checks using the actual current entitlement function.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create table profiles(id uuid primary key,role text);
create table chat_accounts(id uuid primary key,longboard_user_id uuid);
create table user_tags(user_id uuid,tag text);
create table chat_provider_identities(account_id uuid,provider text,membership_level text,verified_at timestamptz);
create table longboard_chat_members(id uuid primary key,user_id uuid,display_name text,accepts_requests boolean default true);
create table longboard_chat_blocks(blocker_id uuid,blocked_id uuid);
grant usage on schema public to anon,authenticated,service_role;
grant all on all tables in schema public to service_role;
`);
const entitlement = await readFile(new URL('../../supabase/migrations/20260918160518_chat_admin_public_room_access.sql', import.meta.url), 'utf8');
await db.exec(entitlement.slice(0, entitlement.indexOf('-- Authoritative profile role')));
await db.exec(await readFile(new URL('../../supabase/migrations/20260919115347_chat_room_members.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('../../supabase/migrations/20260919163405_chat_room_member_count.sql', import.meta.url), 'utf8'));
const add = async (name, kind) => {
  const id = randomUUID(), user = randomUUID();
  await query('insert into chat_accounts values($1,$2)', [user, kind === 'ss' ? null : user]);
  if (kind !== 'ss') await query('insert into profiles values($1,$2)', [user, kind === 'admin' ? 'admin' : 'user']);
  if (kind === 'board') await query("insert into user_tags values($1,'boardroom-cohort-1')", [user]);
  if (kind === 'ss') await query("insert into chat_provider_identities values($1,'shortscout','mastermind',now())", [user]);
  await query('insert into longboard_chat_members(id,user_id,display_name) values($1,$2,$3)', [id, user, name]);
  return { id, user };
};
const { readdir } = await import('node:fs/promises');
const migration = (await readdir(new URL('../../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('_chat_room_members_ordered.sql'));
assert.equal(migration.length, 1, 'one additive ordered directory migration');
await db.exec(await readFile(new URL('../../supabase/migrations/' + migration[0], import.meta.url), 'utf8'));
const actor = await add('Z Viewer', 'board');
const all = [];
for (let i = 124; i >= 0; i--) all.push(await add((i % 2 ? 'member ' : 'Member ') + String(i).padStart(3, '0'), 'social'));
const ties = [await add('Same', 'social'), await add('same', 'social')];
const blocked = await add('AAA Blocked', 'social');
const expired = await add('AAA Expired', 'ss');
await query("update chat_provider_identities set verified_at=now()-interval '13 hours' where account_id=$1", [expired.user]);
await query('insert into longboard_chat_blocks values($1,$2)', [actor.id, blocked.id]);
const online = [...all.slice(0, 73).map(m => m.id), ...ties.map(m => m.id), blocked.id, expired.id, randomUUID()];
await db.exec('set role service_role');
const list = (ids=online, after=null, term='', room='social', user=actor.user) => query('select * from longboard_chat_room_members_ordered($1,$2,$3,$4,$5,$6,$7)', [user,room,term,ids,after?.sort_rank ?? null,after?.sort_name ?? null,after?.id ?? null]);
async function traverse(ids=online,term='') {
 const rows=[]; let after=null;
 for (let page=0;page<20;page++) {
  const batch=await list(ids,after,term); assert.ok(batch.length<=51);
  rows.push(...batch.slice(0,50));
  if(batch.length<=50) return rows;
  after=batch[49];
 }
 throw Error('pagination did not terminate');
}
const rows=await traverse();
assert.equal(rows.length,128);assert.equal(new Set(rows.map(m=>m.id)).size,128);
assert.ok(rows.slice(0,75).every(m=>m.sort_rank===0));assert.ok(rows.slice(75).every(m=>m.sort_rank===1));
assert.ok(!rows.some(m=>m.id===blocked.id||m.id===expired.id));
for(let i=1;i<rows.length;i++){
 const a=rows[i-1],b=rows[i];
 assert.ok(a.sort_rank<b.sort_rank || (a.sort_rank===b.sort_rank&&(a.sort_name<b.sort_name||(a.sort_name===b.sort_name&&a.id<b.id))), 'global deterministic alphabetical ordering');
}
await assert.rejects(()=>query('select * from longboard_chat_room_members_ordered($1,$2,$3,$4,$5,$6,$7)',[actor.user,'social','',online,null,'x',actor.id]),/invalid_cursor/);
const first=await list();assert.equal(first.length,51);
const second=await list(online,first[49]);assert.equal(second[0].id,first[50].id);
assert.deepEqual(await list(),first,'returning to previous page is stable');
assert.ok((await traverse([], 'member')).every(m=>m.sort_rank===1));
assert.equal((await traverse([], 'member')).length,125);
assert.equal((await list(online,null,'%')).length,0);
assert.ok((await list([],null,'Same')).every(m=>m.sort_rank===1));
const duplicateHints=await list([...online,...online]);assert.deepEqual(duplicateHints,first);
// Cursor contains the sort tuple: deleting its member cannot invalidate later pages.
const cursor=first[49];await query('delete from longboard_chat_members where id=$1',[cursor.id]);
assert.deepEqual(await list(online,cursor),second);
// Supplying another room's or an expired/blocked member's presence never grants access.
const main=await list(online,null,'','main');assert.deepEqual(main.map(m=>m.id),[actor.id]);
await assert.rejects(()=>list(online,null,'','shortscout'),/room_access_required/);
await assert.rejects(()=>list(online,null,'','unknown'),/invalid_room/);
// A fresh presence snapshot moves an old offline member ahead of all offline names.
const newlyOnline=all.at(-1).id;
const changed=await traverse([newlyOnline]);
assert.equal(changed[0].id,newlyOnline);assert.equal(changed[0].sort_rank,0);
assert.ok(changed.slice(1).every(m=>m.sort_rank===1));
assert.equal(new Set(changed.map(m=>m.id)).size,127);
const keys=Object.keys(first[0]).sort();assert.deepEqual(keys,['display_name','id','sort_name','sort_rank']);
await query('delete from longboard_chat_members where id=$1',[actor.id]);
await assert.rejects(()=>list(),/member_required/);
for(const role of ['anon','authenticated']){
 await db.exec('reset role; set role '+role);
 await assert.rejects(()=>list(),/permission denied/);
}
await db.close();
console.log('PASS ordered directory SQL: 128 eligible members, 75 online, three pages, global alpha and tied names, no overlap/omissions, search, empty/duplicate/foreign hints, deleted cursor, eligibility/blocks/expiry and service-only grants.');
