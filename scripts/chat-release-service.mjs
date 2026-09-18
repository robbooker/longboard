import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const REPO = 'robbooker/longboard';
export const PROJECT = 'qnwizieggisnbjqyxrjo';
export const VERCEL_PROJECT = 'prj_K24309LtTaSODjn6XwG0D88RH1Nm';
export const TEAM = 'team_un1RvBbSbnPdtpzuoJZjMNAn';
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const sql = value => "'" + String(value).replaceAll("'", "''") + "'";
function requireThat(condition, message) { if (!condition) throw new Error(message); }
class Waiting extends Error {}
export function validateRelease(r) {
 requireThat(r && uuid(r.request_id) && r.repository === REPO && sha(r.head_sha) && Number.isSafeInteger(r.version) && r.version > 0 && Number.isSafeInteger(r.pr_number) && r.pr_number > 0 && r.state === 'approved' && uuid(r.approved_by) && r.approved_at, 'Invalid approved release');
}
export function validatePull(r, pr) {
 requireThat(pr.head?.sha === r.head_sha && pr.head?.repo?.full_name === REPO && pr.base?.repo?.full_name === REPO && pr.base?.ref === 'main', 'PR repository, base or approved head changed; reapproval required');
 if (pr.state === 'open' && pr.mergeable === null) throw new Waiting('GitHub is computing mergeability');
 requireThat(!pr.merged && pr.state === 'open' && pr.mergeable === true, 'PR must be open and mergeable; already-merged recovery requires operator inspection');
}
export function validatePlan(plan, files, requestId) {
 requireThat(plan?.requestId === requestId && plan.version === 1 && Array.isArray(plan.migrations) && plan.migrations.length <= 10, 'Missing or invalid reviewed release plan');
 const changed = files.filter(f => [f.filename,f.previous_filename].some(path => path?.startsWith('supabase/migrations/')));
 requireThat(changed.every(f => f.status === 'added') && changed.length === plan.migrations.length, 'Migration changes must be additions and exactly match the release plan');
 for (const migration of plan.migrations) {
  requireThat(/^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/.test(migration.path) && /^[a-f0-9]{64}$/.test(migration.sha256) && migration.backwardCompatible === true, 'Migration needs a pinned digest and reviewed pre-deployment compatibility');
 }
 requireThat(new Set(plan.migrations.map(m => m.path)).size === changed.length && changed.every(f => plan.migrations.some(m => m.path === f.filename)), 'Migration plan does not match changed files');
 requireThat(Array.isArray(plan.probes) && plan.probes.length > 0 && plan.probes.length <= 10, 'Release needs live probes');
 for (const probe of plan.probes) requireThat(typeof probe.path === 'string' && /^\/[a-zA-Z0-9/_?=&.-]*$/.test(probe.path) && !probe.path.startsWith('//') && Number.isInteger(probe.status) && probe.status >= 200 && probe.status < 500 && typeof probe.contains === 'string' && probe.contains.length >= 3, 'Invalid fixed-origin live probe');
}
export function validateChecks(checks, statuses, mergeSha) {
 requireThat(checks.filter(c=>c.status==='completed').every(c=>['success','neutral','skipped'].includes(c.conclusion)), 'A completed check failed');
 requireThat(statuses.every(s=>['success','pending'].includes(s.state)), 'A commit status failed');
 const required=checks.find(c=>c.name==='Chat release checks'&&c.app?.slug==='github-actions'&&c.head_sha===mergeSha);
 if(!required || checks.some(c=>c.status!=='completed') || statuses.some(s=>s.state==='pending')) throw new Waiting('Waiting for current integration checks');
 requireThat(required.conclusion==='success','Required integration check did not succeed');
}
export function apiClient(env, fetcher = fetch) {
 const origins = { github: 'https://api.github.com', supabase: 'https://api.supabase.com', vercel: 'https://api.vercel.com' };
 const tokens = { github: env.GITHUB_TOKEN, supabase: env.SUPABASE_RELEASE_TOKEN, vercel: env.VERCEL_RELEASE_TOKEN };
 for (const value of Object.values(tokens)) requireThat(value, 'Release credentials are not configured');
 return async (service, path, body, method = body ? 'POST' : 'GET') => {
  requireThat(origins[service] && path.startsWith('/'), 'Invalid API destination');
  const response = await fetcher(origins[service] + path, {method, redirect:'error', signal:AbortSignal.timeout(30_000), headers:{Authorization:`Bearer ${tokens[service]}`,Accept:'application/json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'}, ...(body ? {body:JSON.stringify(body)} : {})});
  // Never log API response bodies: they can include private data or credentials.
  requireThat(response.ok, `${service} API ${method} failed (${response.status})`);
  return response.status === 204 ? null : response.json();
 };
}
export async function runRelease({api, fetcher = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), dryRun = false, credentialsOnly = false, runId}) {
 requireThat(/^\d+$/.test(String(runId)), 'GitHub run ID required');
 const db = query => api('supabase', `/v1/projects/${PROJECT}/database/query`, {query});
 const gh = (path, body, method) => api('github', `/repos/${REPO}${path}`, body, method);
 if (credentialsOnly) {
  requireThat(dryRun, 'Credential checks must be read-only');
  await db('select 1 as release_connection_check');
  await gh('/branches/main/protection');
  const project=await api('vercel',`/v9/projects/${VERCEL_PROJECT}?teamId=${TEAM}`);
  requireThat(project.id===VERCEL_PROJECT,'Vercel project access not verified');
  return {status:'credentials_verified'};
 }
 const rows = await db(`select l.* from public.chat_feature_releases l where l.state='approved' and exists(select 1 from public.chat_feature_members m where m.account_id=l.approved_by and m.role='owner') and exists(select 1 from public.chat_feature_requests r where r.id=l.request_id and r.status='ready') and not exists(select 1 from public.chat_feature_releases where state in ('publishing','failed')) order by l.approved_at limit 1`);
 if (!rows.length) return {status:'idle'};
 const r = rows[0]; validateRelease(r);
 const worker = randomUUID();
 let claimed=false;
 const claim = async()=>{ const rows=await db(`update public.chat_feature_releases l set state='publishing',worker_token=${sql(worker)},claimed_at=now(),updated_at=now() where request_id=${sql(r.request_id)} and state='approved' and head_sha=${sql(r.head_sha)} and version=${Number(r.version)} and approved_by=${sql(r.approved_by)} and exists(select 1 from public.chat_feature_members m where m.account_id=l.approved_by and m.role='owner') and not exists(select 1 from public.chat_feature_releases where state in ('publishing','failed')) returning request_id`); claimed=rows.length===1; return claimed; };
 const update = (result,message,merge=null,deployment=null) => db(`select public.update_chat_feature_release(${sql(r.request_id)},${sql(worker)},${sql(r.head_sha)},${sql(result)},${sql(message)},${merge?sql(merge):'null'},${deployment?sql(deployment):'null'})`);
 try {
 let pr = await gh(`/pulls/${r.pr_number}`); validatePull(r, pr);
 const files = [];
 for (let page=1; page<=30; page++) { const batch=await gh(`/pulls/${r.pr_number}/files?per_page=100&page=${page}`); files.push(...batch); if(batch.length<100)break; requireThat(page<30,'PR too large for automatic release'); }
 // Runner/workflow changes require a separate reviewed bootstrap, never self-modify in a release.
 requireThat(!files.some(f => [f.filename,f.previous_filename].some(path => path?.startsWith('.github/workflows/') || path?.startsWith('scripts/chat-release-'))), 'Release infrastructure changes require a separate reviewed rollout');
 const blob = async path => {
  const content = await gh(`/contents/${path}?ref=${r.head_sha}`);
  requireThat(content.encoding === 'base64' && content.type === 'file' && content.size < 1_000_000, 'Invalid release file');
  return Buffer.from(content.content, 'base64').toString('utf8');
 };
 const plan = JSON.parse(await blob(`.release/${r.request_id}.json`)); validatePlan(plan, files, r.request_id);
 requireThat(sha(pr.merge_commit_sha), 'Integration commit unavailable');
 const integrationSha = pr.merge_commit_sha;
 const base = await gh('/git/ref/heads/main');
 const integration = await gh(`/git/commits/${integrationSha}`);
 requireThat(integration.parents?.[0]?.sha === base.object.sha && integration.parents?.[1]?.sha === r.head_sha,'Integration does not match current main and approved head');
 const checkResult = await gh(`/commits/${integrationSha}/check-runs?per_page=100`);
 requireThat(checkResult.total_count <= 100,'Too many checks');
 const statuses = await gh(`/commits/${integrationSha}/status`);
 const protection = await gh('/branches/main/protection');
 requireThat(protection.enforce_admins?.enabled === true && protection.required_status_checks?.strict === true && protection.required_status_checks.contexts?.includes('Chat release checks'), 'Main must enforce up-to-date Chat release checks including administrators');
 const bypass = protection.required_pull_request_reviews?.bypass_pull_request_allowances;
 requireThat(!bypass || Object.values(bypass).every(entries => Array.isArray(entries) && entries.length === 0), 'Main must not allow release-actor bypass');
 validateChecks(checkResult.check_runs, statuses.statuses, integrationSha);
 const migrationBodies = [];
 for (const m of plan.migrations) {
  const query = await blob(m.path);
  requireThat(createHash('sha256').update(query).digest('hex') === m.sha256,'Migration digest mismatch');
  migrationBodies.push({query,name:m.path.split('/').at(-1).replace('.sql','')});
 }
 if (dryRun) return {status:'validated',requestId:r.request_id,pr:r.pr_number};
 if(!await claim()) return {status:'lost_claim'};
  await update('progress',`Release service started. GitHub run ${runId}; approved PR #${r.pr_number}.`);
  pr = await gh(`/pulls/${r.pr_number}`); validatePull(r,pr);
  requireThat(pr.merge_commit_sha === integrationSha,'Main or integration commit changed since validation');
  for (const m of migrationBodies) {
   const previous = await db(`select name from supabase_migrations.schema_migrations where name=${sql(m.name)}`);
   requireThat(previous.length === 0, 'Migration already recorded; operator inspection required before retry');
   await api('supabase',`/v1/projects/${PROJECT}/database/migrations`,m);
   const recorded = await db(`select name from supabase_migrations.schema_migrations where name=${sql(m.name)}`);
   requireThat(recorded.length === 1,'Migration application not recorded');
  }
  pr = await gh(`/pulls/${r.pr_number}`); validatePull(r,pr);
  requireThat(pr.merge_commit_sha === integrationSha,'Integration changed during migration; stop before merge');
  // Re-check owner approval immediately before merge, including after migrations.
  const authorized = await db(`select l.request_id from public.chat_feature_releases l join public.chat_feature_members m on m.account_id=l.approved_by and m.role='owner' where l.request_id=${sql(r.request_id)} and l.state='publishing' and l.worker_token=${sql(worker)} and l.head_sha=${sql(r.head_sha)}`);
  requireThat(authorized.length === 1,'Owner approval revoked');
  const currentBase = await gh('/git/ref/heads/main');
  requireThat(currentBase.object.sha === base.object.sha,'Main changed before merge');
  if(pr.draft) await api('github','/graphql',{query:'mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{id}}}',variables:{id:pr.node_id}});
  const merged = await gh(`/pulls/${r.pr_number}/merge`,{sha:r.head_sha,merge_method:'squash'},'PUT');
  requireThat(merged.merged && sha(merged.sha),'Merge not confirmed; inspect before retrying');
  await update('progress',`Merged ${merged.sha}. Waiting for production deployment.`);
  // Explicit deployment: does not depend on GITHUB_TOKEN generating another workflow/webhook.
  const deployment = await api('vercel',`/v13/deployments?teamId=${TEAM}`,{name:'longboard',project:VERCEL_PROJECT,target:'production',gitSource:{type:'github',repoId:pr.base.repo.id,ref:merged.sha}});
  requireThat(/^dpl_[A-Za-z0-9]+$/.test(deployment.id),'Deployment ID missing');
  let ready;
  for(let attempt=0;attempt<80;attempt++) {
   const d=await api('vercel',`/v13/deployments/${deployment.id}?teamId=${TEAM}`);
   requireThat(!['ERROR','CANCELED'].includes(d.readyState),'Production deployment failed');
   if(d.readyState==='READY'){ready=d;break;} await sleep(15000);
  }
  requireThat(ready && ready.target==='production' && ready.projectId===VERCEL_PROJECT && ready.meta?.githubCommitSha===merged.sha,'Exact production deployment not verified');
  for(const domain of ['www.longboardai.com','longboardai.com']) {
   const alias=await api('vercel',`/v4/aliases/${domain}?teamId=${TEAM}`);
   requireThat(alias.deployment?.id===deployment.id,'Live domain is not on the approved deployment');
  }
  for(const probe of plan.probes) {
   const response=await fetcher('https://www.longboardai.com'+probe.path,{redirect:'manual',signal:AbortSignal.timeout(30000),headers:{'Cache-Control':'no-cache'}});
   requireThat(response.status===probe.status && (await response.text()).includes(probe.contains),'Live release probe failed');
  }
  await update('published',`Published PR #${r.pr_number}; exact production commit, both live aliases and ${plan.probes.length} live probes verified. Run ${runId}.`,merged.sha,deployment.id);
  return {status:'published',pr:r.pr_number};
 } catch(error) {
  if(error instanceof Waiting && !claimed) return {status:'waiting',reason:error.message};
  if (!dryRun && (claimed || await claim())) await update('failed',`Release stopped in GitHub run ${runId}: ${error.message}. Inspect migrations/merge/deployment before owner reconfirmation. No automatic retry.`);
  throw error;
 }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'2-digit',hourCycle:'h23'}).format(new Date()));
 if(process.env.GITHUB_EVENT_NAME==='schedule' && (hour<7 || hour>=17)) process.exit(0);
 runRelease({api:apiClient(process.env),runId:process.env.GITHUB_RUN_ID,credentialsOnly:process.env.RELEASE_CREDENTIALS_ONLY==='true',dryRun:process.env.RELEASE_DRY_RUN!=='false'}).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
