import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
const root=new URL('../../',import.meta.url).pathname;
const db=new PGlite({extensions:{vector}});
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema extensions; create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,public to anon,authenticated,service_role;
create table profiles(id uuid primary key,email text,role text);
create table user_tags(user_id uuid,tag text);
grant select on profiles,user_tags to authenticated,service_role;
alter table profiles enable row level security;
create policy self on profiles for select to authenticated using(id=auth.uid());
alter default privileges in schema public grant all on tables to service_role;
create publication supabase_realtime;`);
for(const file of ['20260827135528_public_chat_guest_room.sql','20260901125001_longboard_chat_admin_buddy.sql','20260915115419_chat_member_direct_messages.sql','20260915204338_chat_social_room.sql','20260915225504_member_chat_search.sql','20260915231144_chat_semantic_search.sql','20260915232125_chat_shortscout_admin_room.sql']) await db.exec(await readFile(`${root}/supabase/migrations/${file}`,'utf8'));
const people=['Alice','Bob','Mallory'].map((name,i)=>({id:`00000000-0000-4000-8000-00000000000${i+1}`,email:`${name.toLowerCase()}@example.test`,name}));
const users=new Map();
for(const p of people){
 await db.query('insert into auth.users values($1)',[p.id]); await db.query("insert into profiles values($1,$2,'user')",[p.id,p.email]);
 const m=(await db.query('select longboard_chat_link_member($1,$2,null) as m',[p.id,p.name])).rows[0].m;
 p.member=m;
 const token=[{alg:'HS256',typ:'JWT'},{sub:p.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+86400,aud:'authenticated'},'signature'].map((x)=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url')).join('.');
 p.token=token; users.set(token,p);
 await db.query('insert into longboard_chat_messages(guest_id,member_id,author_label,body) values($1,$1,$2,$3)',[m.id,p.name,p.name==='Bob'?'Happy to compare notes on this morning’s session.':p.name==='Alice'?'Good morning, Longboard!':'Looking forward to the discussion.']);
}
await db.query("update profiles set role='admin' where email='alice@example.test'");
const bobRequest=(await db.query("select longboard_chat_dm_action($1,'request',$2,'Hi Alice! Would you like to compare notes on the morning session?',$3,null) as r",[people[1].id,people[0].member.id,crypto.randomUUID()])).rows[0].r;
for(let i=0;i<80;i++) await db.query("insert into longboard_chat_messages(guest_id,member_id,author_label,body,created_at) values($1,$1,'Bob',$2,now()+($3 * interval '1 second'))",[people[1].member.id,`History message ${i+1}`,i-79]);
await db.query('update longboard_chat_embeddings set embedding=$1',[JSON.stringify([1,...Array(1535).fill(0)])]);
await db.exec(await readFile(`${root}/supabase/migrations/20260916142421_shared_chat_login.sql`,'utf8'));
await db.exec(await readFile(`${root}/supabase/migrations/20260916160122_chat_message_actions.sql`,'utf8'));
await db.exec(await readFile(`${root}/supabase/migrations/20260916171034_private_chat_features.sql`,'utf8'));
await db.exec(await readFile(`${root}/supabase/migrations/20260916174554_chat_feature_notifications.sql`,'utf8'));
await db.query("insert into chat_feature_members values($1,'owner'),($2,'participant')",[people[0].id,people[1].id]);
await db.query("insert into longboard_chat_messages(id,guest_id,member_id,author_label,body) values('20000000-0000-4000-8000-000000000001',$1,$1,'Alice','Reaction tooltip verification message')",[people[0].member.id]);
for(const [i,p] of people.entries()) await db.query("insert into longboard_chat_reactions(message_id,guest_id,active) values('20000000-0000-4000-8000-000000000001',$1,$2)",[p.member.id,i<2]);
const scoutId='00000000-0000-4000-8000-000000000099';
const scoutToken='s'.repeat(43);
await db.query('insert into chat_accounts(id) values($1)',[scoutId]);
await db.query("insert into chat_provider_identities(provider,subject,account_id,membership_level) values('shortscout',$1,$1,'mastermind')",[scoutId]);
const {createHash}=await import('node:crypto');
await db.query("insert into chat_sessions(token_hash,account_id,expires_at) values($1,$2,now()+interval '12 hours')",[createHash('sha256').update(scoutToken).digest('hex'),scoutId]);
const scoutMember=(await db.query("select longboard_chat_link_member($1,'Scout Tester',null) as m",[scoutId])).rows[0].m;
await db.query("insert into longboard_chat_messages(guest_id,member_id,room_slug,author_label,body) values($1,$1,'shortscout','Scout Tester','Welcome to the SS member room.')",[scoutMember.id]);
await db.exec(await readFile(`${root}/supabase/migrations/20260916211649_chat_room_summary_inbox.sql`,'utf8'));
await db.exec(await readFile(`${root}/supabase/migrations/20260916213912_chat_activity_notifications.sql`,'utf8'));
await db.query("insert into longboard_chat_messages(guest_id,member_id,author_label,body,room_slug) values($1,$1,'Bob','@Alice please check SOCIAL','social')",[people[1].member.id]);
await db.exec(await readFile(`${root}/supabase/migrations/20260917020216_chat_thread_counts.sql`,'utf8'));
console.log('Isolated chat fixture server on http://127.0.0.1:54404. Test users: alice@example.test, bob@example.test, mallory@example.test; password: demo-only');
function user(p){return {id:p.id,email:p.email,role:'authenticated',aud:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};}
function session(p){return {access_token:p.token,refresh_token:`refresh-${p.id}`,token_type:'bearer',expires_in:86400,user:user(p)};}
let queue=Promise.resolve();
createServer((req,res)=>{queue=queue.then(async()=>{
 res.setHeader('Access-Control-Allow-Origin','http://localhost:3204');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,prefer,accept-profile,content-profile,x-supabase-api-version');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 const send=(v,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(v));};
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/test/scout') {res.writeHead(302,{'Set-Cookie':`lb-chat-session=${scoutToken}; Path=/; HttpOnly; SameSite=Lax`,'Location':'http://localhost:3204/chat?room=shortscout&popout=1'});res.end();return;}
 let body='';for await(const chunk of req)body+=chunk;
 const payload=body?JSON.parse(body):{};const bearer=(req.headers.authorization||'').replace(/^Bearer /,'');const person=users.get(bearer);
 if(url.pathname.startsWith('/auth/v1/')){
  if(url.pathname.endsWith('/token')) {const p=people.find(p=>p.email===payload.email||`refresh-${p.id}`===payload.refresh_token);return p&&(!payload.password||payload.password==='demo-only')?send(session(p)):send({msg:'Invalid credentials'},400);}
  if(url.pathname.endsWith('/user'))return person?send(user(person)):send({msg:'Not signed in'},401);
  if(url.pathname.endsWith('/logout'))return send({});
 }
 if(!url.pathname.startsWith('/rest/v1/'))return send({},404);
 const role=bearer==='test-service-role'?'service_role':person?'authenticated':'anon';
 const ident=x=>{if(!/^[a-z_][a-z0-9_]*$/.test(x))throw Error('Invalid SQL identifier');return '"'+x+'"';};
 try{
  await db.exec(`reset role;set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[person?.id||'']);
  let rows;
  if(url.pathname.includes('/rpc/')){
   const fn=url.pathname.split('/').pop();const entries=Object.entries(payload);const args=entries.map(([k],i)=>`${ident(k)} => $${i+1}`).join(',');
   if(['chat_thread_counts','search_longboard_chat','longboard_chat_search_context','search_longboard_chat_semantic','claim_longboard_chat_embeddings'].includes(fn)) return send((await db.query(`select * from public.${ident(fn)}(${args})`,entries.map(([,v])=>v))).rows);
   rows=(await db.query(`select public.${ident(fn)}(${args}) as result`,entries.map(([,v])=>v))).rows;return send(rows[0].result);
  }
  const table=ident(url.pathname.split('/').pop()); const values=[];const bind=v=>{values.push(v);return '$'+values.length;};
  const filters=[];
  for(const [key,value]of url.searchParams){if(['select','limit','order','on_conflict'].includes(key))continue;if(key==='or'){filters.push('('+value.slice(1,-1).split(',').map(part=>{const [column,op,val]=part.split('.');if(op!=='eq')throw Error('bad or');return ident(column)+'='+bind(val)}).join(' or ')+')');continue;}const [op,...rest]=value.split('.');const v=rest.join('.');if(op==='is'&&v==='null'){filters.push(ident(key)+' is null');}else if(op==='in'){filters.push(`${ident(key)} in (${v.slice(1,-1).split(',').map(bind).join(',')})`);}else if(['eq','gt','gte','lt','lte'].includes(op)){filters.push(`${ident(key)} ${{eq:'=',gt:'>',gte:'>=',lt:'<',lte:'<='}[op]} ${bind(v)}`);}else if(op==='ilike')filters.push(`${ident(key)} ilike ${bind(v)}`);else if(op==='like')filters.push(`${ident(key)} like ${bind(v)}`);else throw Error('Unsupported filter '+op);}
  const where=filters.length?' where '+filters.join(' and '):'';
  const fields=(url.searchParams.get('select')||'*').split(',').map(x=>x==='*'?'*':ident(x)).join(',');let sql;
  if(req.method==='GET'||req.method==='HEAD'){
   sql=`select ${fields} from public.${table}${where}`;
   if(url.searchParams.has('order')){sql+=' order by '+url.searchParams.get('order').split(',').map(x=>{const [col,dir]=x.split('.');return ident(col)+(dir==='desc'?' desc':' asc');}).join(',');}
   if(url.searchParams.has('limit'))sql+=' limit '+bind(Number(url.searchParams.get('limit')));
  }else if(req.method==='POST'){
   const entries=Object.entries(payload);sql=`insert into public.${table}(${entries.map(([k])=>ident(k)).join(',')}) values(${entries.map(([,v])=>bind(v)).join(',')})`;
   if(req.headers.prefer?.includes('resolution=ignore-duplicates'))sql+=' on conflict do nothing';
   if(req.headers.prefer?.includes('resolution=merge-duplicates')) {const cols=url.searchParams.get('on_conflict').split(',');sql+=` on conflict(${cols.map(ident).join(',')}) do update set `+entries.filter(([k])=>!cols.includes(k)).map(([k])=>`${ident(k)}=excluded.${ident(k)}`).join(',');}
   sql+=' returning '+fields;
  }else if(req.method==='PATCH'){sql=`update public.${table} set `+Object.entries(payload).map(([key,value])=>ident(key)+'='+bind(value)).join(',')+where+' returning '+fields;}else throw Error('Unsupported method');
  rows=(await db.query(sql,values)).rows;
  if(req.method==='HEAD'){res.writeHead(200,{'content-range':`0-${Math.max(0,rows.length-1)}/${rows.length}`});res.end();return;}
  if(req.headers.accept?.includes('vnd.pgrst.object'))return rows.length===1?send(rows[0]):send({code:'PGRST116',details:`The result contains ${rows.length} rows`,message:'Not a single row'},406);
  send(rows);
 }catch(e){send({message:e.message,code:e.code||'TEST_ERROR',details:''},400);}finally{await db.exec('reset role');}
}).catch(e=>{console.error(e.message);res.end();});}).listen(54404,'127.0.0.1');
