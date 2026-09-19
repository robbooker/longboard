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
const add = async (name, kind) => {
  const id = randomUUID(), user = randomUUID();
  await query('insert into chat_accounts values($1,$2)', [user, kind === 'ss' ? null : user]);
  if (kind !== 'ss') await query('insert into profiles values($1,$2)', [user, kind === 'admin' ? 'admin' : 'user']);
  if (kind === 'board') await query("insert into user_tags values($1,'boardroom-cohort-1')", [user]);
  if (kind === 'ss') await query("insert into chat_provider_identities values($1,'shortscout','mastermind',now())", [user]);
  await query('insert into longboard_chat_members(id,user_id,display_name) values($1,$2,$3)', [id, user, name]);
  return { id, user };
};
const actor = await add('Actor', 'board'), board = await add('Board', 'board'), social = await add('Social', 'social'), ss = await add('Scout', 'ss'), admin = await add('Admin', 'admin');
await db.exec('set role service_role');
const list = (room, cursor = null, term = '', user = actor.user) => query('select * from longboard_chat_room_members($1,$2,$3,$4)', [user, room, cursor, term]);
assert.deepEqual(new Set((await list('main')).map(m => m.id)), new Set([actor.id, board.id, admin.id]));
assert.deepEqual(new Set((await list('lb-announcements')).map(m => m.id)), new Set([actor.id, board.id, admin.id]));
assert.equal((await list('social')).length, 5);
assert.deepEqual(new Set((await list('shortscout', null, '', ss.user)).map(m => m.id)), new Set([ss.id, admin.id]));
assert.deepEqual(new Set((await list('ss-announcements', null, '', ss.user)).map(m => m.id)), new Set([ss.id, admin.id]));
await assert.rejects(() => list('main', null, '', social.user), /room_access_required/);
await assert.rejects(() => list('shortscout'), /room_access_required/);
await query('delete from user_tags where user_id=$1', [board.user]);
assert.ok(!(await list('main')).some(m => m.id === board.id));
await query("update chat_provider_identities set verified_at=now()-interval '13 hours' where account_id=$1", [ss.user]);
assert.ok(!(await list('social')).some(m => m.id === ss.id));
await assert.rejects(() => list('shortscout', null, '', ss.user), /room_access_required/);
for (const [blocker, blocked] of [[actor.id, social.id], [social.id, actor.id]]) {
  await query('insert into longboard_chat_blocks values($1,$2)', [blocker, blocked]);
  assert.ok(!(await list('social')).some(m => m.id === social.id));
  await query('delete from longboard_chat_blocks');
}
// DM opt-out remains visible: the existing DM action enforces request preferences.
await query('update longboard_chat_members set accepts_requests=false where id=$1', [social.id]);
assert.ok((await list('social')).some(m => m.id === social.id));
assert.deepEqual(Object.keys((await list('social'))[0]).sort(), ['display_name', 'id']);
assert.equal((await list('social', null, '%')).length, 0);
assert.equal((await list('social', null, 'ocia')).length, 1);
for (let i = 0; i < 60; i++) await add('Extra ' + i, 'social');
const first = await list('social'); assert.equal(first.length, 51);
const second = await list('social', first[49].id);
assert.equal(second[0].id, first[50].id);
assert.ok(second.every(row => !first.slice(0, 50).some(old => old.id === row.id)));
assert.equal(first.slice(0, 50).length + second.length, 64);
await query('delete from user_tags where user_id=$1', [actor.user]);
await assert.rejects(() => list('main'), /room_access_required/);
await query('delete from longboard_chat_members where id=$1', [actor.id]);
await assert.rejects(() => list('social'), /member_required/);
for (const role of ['anon', 'authenticated']) {
  await db.exec('reset role; set role ' + role);
  await assert.rejects(() => list('social'), /permission denied/);
}
await db.close();
console.log('PASS room directory SQL: room isolation, current entitlements, expiration, blocks, projection, pagination, opt-out and grants.');
