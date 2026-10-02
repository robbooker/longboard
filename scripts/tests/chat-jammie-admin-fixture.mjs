// Synthetic local Auth/PostgREST adapter with the published chat SQL. Never deploy.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-jammie-admin-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-shortscout-authorization-fixture.mjs',import.meta.url),'utf8');
source=source.replaceAll("||'54555'","||'54567'").replaceAll("||'3355'","||'3367'");
source=source.replace("'20261001190002_chat_shortscout_authorization.sql'","'20261001190002_chat_shortscout_authorization.sql','20261001191605_chat_pinned_unread.sql','20261002120756_chat_member_display_names.sql','20261002140651_chat_room_message_pins.sql','20260917205526_chat_archive_declined.sql','20260918134410_chat_edit_approved_request.sql','20260928120621_chat_jammie_development_approval.sql','20261002125758_chat_feature_archive_order.sql','20261002150404_chat_ticket_delete.sql','20261002152103_chat_notification_list.sql','20261002153528_chat_phone_notification_layout.sql'");
source=source.replace("['chat_member_membership_sources'","['longboard_chat_room_members_ordered','longboard_chat_room_members','chat_member_membership_sources'");
// Test SQL represents the migration connection, not the previous browser JWT.
source=source.replace("if(url.pathname==='/test/sql'){await db.exec('reset role');", "if(url.pathname==='/test/sql'){await db.exec('reset role');await db.query(\"select set_config('request.jwt.claim.sub','',false)\");");
const prepare=`
await db.exec("alter table profiles add column created_at timestamptz default now(),add column updated_at timestamptz default now();grant update on profiles to service_role");
// Real role-escalation trigger, without unrelated Vault extension requirements.
const foundation=await readFile(root+'/supabase/migrations/20260413_phase2a_multitenant.sql','utf8');
for(const fn of ['is_admin','prevent_role_self_escalation'])await db.exec(foundation.match(new RegExp('create or replace function '+fn+'[\\\\s\\\\S]*?\\\\$\\\\$;'))[0]);
await db.exec('create trigger profiles_prevent_role_escalation before update on profiles for each row execute function prevent_role_self_escalation()');
await db.exec('create table invites(id uuid,email text,invited_by_email text,created_at timestamptz,accepted_at timestamptz,revoked_at timestamptz,status text);create table signup_requests(id uuid,email text,message text,status text,created_at timestamptz,reviewed_by uuid,reviewed_at timestamptz,source_ip text,user_agent text)');
const jammie={id:'6ad10d99-fe91-4955-86fa-a893b9763573',email:'ojammie@gmail.com',name:'Jammie Synthetic'};
await db.query('insert into auth.users values($1)',[jammie.id]);
await db.query("insert into profiles(id,email,role) values($1,$2,'user')",[jammie.id,jammie.email]);
await db.query('insert into chat_accounts(id,longboard_user_id) values($1,$1)',[jammie.id]);
jammie.member=(await db.query('select longboard_chat_link_member($1,$2,null) m',[jammie.id,jammie.name])).rows[0].m;
jammie.token=[{alg:'HS256',typ:'JWT'},{sub:jammie.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+86400,aud:'authenticated'},'signature'].map(x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url')).join('.');
people.push(jammie);users.set(jammie.token,jammie);
await db.query("delete from chat_feature_members where role='participant'");
await db.query("insert into chat_feature_members(account_id,role,can_approve_development) values($1,'participant',true)",[jammie.id]);
await db.query("insert into chat_provider_identities(provider,subject,account_id,membership_level) values('shortscout',$1,$1,'mastermind')",[jammie.id]);
await db.query("insert into chat_sessions(token_hash,account_id,expires_at) values($1,$2,now()+interval '12 hours')",[createHash('sha256').update('j'.repeat(43)).digest('hex'),jammie.id]);
`;
// Add setup after the final published migrations, before any request can arrive.
source=source.replace('await writeFile(target,source);',`source=source.replace('function user(p)',${JSON.stringify(prepare+'\nfunction user(p)')});
source=source.replace("if(url.pathname.startsWith('/auth/v1/')){", "if(url.pathname==='/auth/v1/admin/users'&&bearer==='test-service-role')return send({users:people.map(user),aud:'authenticated'});\\n if(url.pathname.startsWith('/auth/v1/')){");
await writeFile(target,source);`);
await writeFile(target,source);try{await import(target.href);}finally{await unlink(target);}
