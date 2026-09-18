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
export function validateRelease(r, preview = false) {
 requireThat(r && uuid(r.request_id) && r.repository === REPO && sha(r.head_sha) && Number.isSafeInteger(r.version) && r.version > 0 && Number.isSafeInteger(r.pr_number) && r.pr_number > 0 && (r.state === 'approved' || (preview && r.state === 'ready')) && (preview || (uuid(r.approved_by) && r.approved_at)), 'Invalid approved release');
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
export function checkedOutCommit(log) {
 const match = log.match(/\[command\]\/usr\/bin\/git log -1 --format=%H\r?\n[^\n]*?Z ([a-f0-9]{40})\r?\n/);
 requireThat(match,'CI checkout evidence missing');
 return match[1];
}
export function apiClient(env, fetcher = fetch) {
 const origins = { github: 'https://api.github.com', supabase: 'https://api.supabase.com', vercel: 'https://api.vercel.com' };
 const tokens = { github: env.GITHUB_TOKEN, supabase: env.SUPABASE_RELEASE_TOKEN, vercel: env.VERCEL_RELEASE_TOKEN };
 for (const value of Object.values(tokens)) requireThat(value, 'Release credentials are not configured');
 return async (service, path, body, method = body ? 'POST' : 'GET') => {
  requireThat(origins[service] && path.startsWith('/'), 'Invalid API destination');
  const response = await fetcher(origins[service] + path, {method, redirect:service==='github' && /\/actions\/jobs\/\d+\/logs$/.test(path)?'manual':'error', signal:AbortSignal.timeout(30_000), headers:{Authorization:`Bearer ${service==='github' && path.includes('/actions/') ? env.GITHUB_ACTIONS_TOKEN || tokens.github : tokens[service]}`,Accept:'application/json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'}, ...(body ? {body:JSON.stringify(body)} : {})});
  // Never log API response bodies: they can include private data or credentials.
  if(service==='github' && /\/actions\/jobs\/\d+\/logs$/.test(path) && response.status===302) {
   const location=new URL(response.headers.get('location'));
   requireThat(location.protocol==='https:','Invalid log download');
   const download=await fetcher(location,{redirect:'error',signal:AbortSignal.timeout(30000)});
   requireThat(download.ok,'CI log download failed');
   const reader=download.body.getReader();const chunks=[];let length=0;
   for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>4_000_000){await reader.cancel();throw new Error('CI log too large');}chunks.push(Buffer.from(value));}
   return Buffer.concat(chunks).toString('utf8');
  }
  requireThat(response.ok, `${service} API ${method} failed (${response.status})`);
  return response.status === 204 ? null : response.json();
 };
}
// Verify what is actually live, including duplicate deployments of the same approved commit.
// This helper is read-only: never promote, redeploy, or repair aliases.
export async function verifyLiveRelease({api, fetcher, plan, mergeSha, repoId, expectedDeployment = null}) {
 requireThat(sha(mergeSha) && Number.isSafeInteger(repoId) && repoId>0,'Invalid expected deployment provenance');
 const aliases = async () => {
  const ids=[];
  for(const domain of ['www.longboardai.com','longboardai.com']) {
   const alias=await api('vercel',`/v4/aliases/${domain}?teamId=${TEAM}`);
   requireThat(/^dpl_[A-Za-z0-9]+$/.test(alias.deployment?.id),'Live alias deployment missing');
   ids.push(alias.deployment.id);
  }
  requireThat(ids[0]===ids[1],'Live aliases disagree');
  return ids[0];
 };
 const id=await aliases();
 requireThat(!expectedDeployment || id===expectedDeployment,'Live deployment changed during reconciliation');
 const verifyDeployment=async()=>{
  const d=await api('vercel',`/v13/deployments/${id}?teamId=${TEAM}&withGitRepoInfo=true`);
  requireThat(d.id===id && d.readyState==='READY' && d.target==='production' && d.projectId===VERCEL_PROJECT && d.meta?.githubCommitSha===mergeSha,'Exact live production deployment not verified');
  // Some owner responses expose Git provenance in meta rather than gitSource.
  // If gitSource is present it must agree; never mask contradictory provenance.
  const meta=d.meta||{};
  const metadataRepo=meta.githubCommitOrg==='robbooker' && meta.githubCommitRepo==='longboard' && String(meta.githubCommitRepoId)===String(repoId) && (!meta.githubHost || meta.githubHost==='github.com');
  for(const [key,expected] of Object.entries({githubCommitOrg:'robbooker',githubCommitRepo:'longboard',githubCommitRepoId:String(repoId),githubOrg:'robbooker',githubRepo:'longboard',githubRepoId:String(repoId),githubHost:'github.com'})) {
   requireThat(meta[key]===undefined || String(meta[key])===expected,'Contradictory deployment repository metadata');
  }
  const gitRepo=d.gitSource?.type==='github' && String(d.gitSource.repoId)===String(repoId);
  requireThat(d.gitSource ? gitRepo : metadataRepo,'Live deployment repository not verified');
  requireThat(!d.gitSource?.sha || d.gitSource.sha===mergeSha,'Live Git source commit differs');
 };
 await verifyDeployment();
 for(const probe of plan.probes) {
  const response=await fetcher('https://www.longboardai.com'+probe.path,{redirect:'manual',signal:AbortSignal.timeout(30000),headers:{'Cache-Control':'no-cache'}});
  requireThat(response.status===probe.status && (await response.text()).includes(probe.contains),'Live release probe failed');
 }
 await verifyDeployment();
 requireThat(await aliases()===id,'Live aliases changed during verification');
 return id;
}

// Manual verification-only recovery for a merged, migration-free release. No mutation
// outside the release record/history is permitted; normal scheduling never enters here.
export async function reconcileRelease({api, fetcher = fetch, dryRun = true, runId, eventName, requestId, expectedMergeSha}) {
 requireThat(eventName==='workflow_dispatch' && uuid(requestId) && sha(expectedMergeSha) && /^\d+$/.test(String(runId)), 'Recovery requires manual dispatch, request UUID and pinned merge SHA');
 const db=query=>api('supabase',`/v1/projects/${PROJECT}/database/query`,{query});
 const gh=path=>api('github',`/repos/${REPO}${path}`);
 const rows=await db(`select l.* from public.chat_feature_releases l where l.request_id=${sql(requestId)} and l.state in ('approved','failed') and exists(select 1 from public.chat_feature_members m where m.account_id=l.approved_by and m.role='owner') and exists(select 1 from public.chat_feature_requests r where r.id=l.request_id and r.status='ready') and not exists(select 1 from public.chat_feature_releases other where other.request_id<>l.request_id and other.state in ('publishing','failed'))`);
 requireThat(rows.length===1,'Recovery release is unavailable, unapproved, active, or blocked by another release');
 const r=rows[0];
 requireThat(['approved','failed'].includes(r.state),'Recovery cannot take an active or completed claim');
 validateRelease({...r,state:'approved'});
 const worker=randomUUID();
 let claimed=false;
 const snapshot=`l.request_id=${sql(r.request_id)} and l.repository=${sql(REPO)} and l.pr_number=${r.pr_number} and l.head_sha=${sql(r.head_sha)} and l.version=${r.version} and l.approved_by=${sql(r.approved_by)} and l.approved_at=${sql(r.approved_at)}::timestamptz and exists(select 1 from public.chat_feature_members m where m.account_id=l.approved_by and m.role='owner') and exists(select 1 from public.chat_feature_requests request where request.id=l.request_id and request.status='ready') and not exists(select 1 from public.chat_feature_releases other where other.request_id<>l.request_id and other.state in ('publishing','failed'))`;
 const authorization=()=>db(`select l.request_id from public.chat_feature_releases l where ${snapshot} and l.state=${sql(claimed?'publishing':r.state)}${claimed?` and l.worker_token=${sql(worker)}`:''}`);
 const update=async(result,message,deployment=null)=>{
  const changed=await db(`select public.update_chat_feature_release(${sql(r.request_id)},${sql(worker)},${sql(r.head_sha)},${sql(result)},${sql(message)},${result==='published'?sql(expectedMergeSha):'null'},${deployment?sql(deployment):'null'}) as result from public.chat_feature_releases l where ${snapshot} and l.state='publishing' and l.worker_token=${sql(worker)}`);
  requireThat(changed.length===1,'Recovery approval or claim changed; no release update made');
 };
 try {
  const validateMerged=async()=>{
   const pr=await gh(`/pulls/${r.pr_number}`);
   requireThat(pr.merged===true && pr.state==='closed' && pr.merge_commit_sha===expectedMergeSha && pr.head?.sha===r.head_sha && pr.head?.repo?.full_name===REPO && pr.base?.repo?.full_name===REPO && pr.base?.ref==='main' && Number.isSafeInteger(pr.base.repo.id),'Merged PR does not match approved release and pinned merge');
   const merged=await gh(`/git/commits/${expectedMergeSha}`);
   const head=await gh(`/git/commits/${r.head_sha}`);
   requireThat(sha(merged.tree?.sha) && merged.tree.sha===head.tree?.sha && merged.parents?.length===1 && sha(merged.parents[0].sha),'Approved head tree does not match squash merge');
   return {pr,merged};
  };
  const {pr,merged}=await validateMerged();
  const ancestry=await gh(`/compare/${expectedMergeSha}...main`);
  requireThat(['identical','ahead'].includes(ancestry.status) && ancestry.merge_base_commit?.sha===expectedMergeSha,'Approved merge is not an ancestor of current main');
  const files=[];
  for(let page=1;page<=30;page++) { const batch=await gh(`/pulls/${r.pr_number}/files?per_page=100&page=${page}`); files.push(...batch); if(batch.length<100)break; requireThat(page<30,'PR too large for recovery'); }
  requireThat(!files.some(f=>[f.filename,f.previous_filename].some(path=>path?.startsWith('.github/workflows/')||path?.startsWith('scripts/chat-release-'))),'Release infrastructure cannot reconcile itself');
  const content=await gh(`/contents/.release/${r.request_id}.json?ref=${r.head_sha}`);
  requireThat(content.encoding==='base64' && content.type==='file' && content.size<1_000_000,'Invalid recovery plan');
  const plan=JSON.parse(Buffer.from(content.content,'base64').toString('utf8'));
  validatePlan(plan,files,r.request_id);
  requireThat(plan.migrations.length===0,'Recovery is limited to releases without migrations');
  // Preserve proof that the approved artifact passed the required integration check.
  const protection=await gh('/branches/main/protection');
  requireThat(protection.enforce_admins?.enabled===true && protection.required_status_checks?.strict===true && protection.required_status_checks.contexts?.includes('Chat release checks'),'Main protection changed');
  const bypass=protection.required_pull_request_reviews?.bypass_pull_request_allowances;
  requireThat(!bypass || Object.values(bypass).every(entries=>Array.isArray(entries)&&entries.length===0),'Main allows review bypass');
  const checks=await gh(`/commits/${r.head_sha}/check-runs?per_page=100`);
  requireThat(checks.total_count<=100,'Too many recovery checks');
  const statuses=await gh(`/commits/${r.head_sha}/status`);
  validateChecks(checks.check_runs,statuses.statuses,r.head_sha);
  const check=checks.check_runs.find(c=>c.name==='Chat release checks'&&c.app?.slug==='github-actions'&&c.head_sha===r.head_sha);
  const details=check.details_url?.match(/^https:\/\/github\.com\/robbooker\/longboard\/actions\/runs\/(\d+)\/job\/(\d+)$/);
  requireThat(details,'Invalid recovery check evidence');
  const run=await gh(`/actions/runs/${details[1]}`);
  const job=await gh(`/actions/jobs/${details[2]}`);
  requireThat(run.head_sha===r.head_sha && run.event==='pull_request' && run.path==='.github/workflows/chat-release-checks.yml' && run.conclusion==='success' && String(job.run_id)===details[1] && job.conclusion==='success' && job.check_run_url?.endsWith(`/check-runs/${check.id}`),'Recovery CI evidence changed');
  const tested=await gh(`/git/commits/${checkedOutCommit(await gh(`/actions/jobs/${details[2]}/logs`))}`);
  requireThat(tested.parents?.[0]?.sha===merged.parents[0].sha && tested.parents?.[1]?.sha===r.head_sha && tested.tree?.sha===merged.tree.sha,'Tested integration does not match approved merge');
  const live=await verifyLiveRelease({api,fetcher,plan,mergeSha:expectedMergeSha,repoId:pr.base.repo.id});
  requireThat((await authorization()).length===1,'Recovery approval changed');
  if(dryRun)return {status:'recovery_validated',requestId,pr:r.pr_number,mergeSha:expectedMergeSha,deploymentId:live};
  const claimedRows=await db(`update public.chat_feature_releases l set state='publishing',worker_token=${sql(worker)},claimed_at=now(),updated_at=now() where ${snapshot} and l.state=${sql(r.state)} returning l.request_id`);
  if(claimedRows.length!==1)return {status:'lost_claim'};
  claimed=true;
  await update('progress',`Manual verification-only recovery started in GitHub run ${runId}. No merge, migration, deployment or alias change will be performed.`);
  await validateMerged();
  const finalAncestry=await gh(`/compare/${expectedMergeSha}...main`);
  requireThat(['identical','ahead'].includes(finalAncestry.status) && finalAncestry.merge_base_commit?.sha===expectedMergeSha,'Main ancestry changed during recovery');
  const finalLive=await verifyLiveRelease({api,fetcher,plan,mergeSha:expectedMergeSha,repoId:pr.base.repo.id,expectedDeployment:live});
  requireThat((await authorization()).length===1,'Recovery approval changed before publication');
  await update('published',`Reconciled PR #${r.pr_number}; approved tree, historical CI, exact existing production commit, both live aliases and live probes verified in run ${runId}. No merge, migration, deployment or alias mutation performed.`,finalLive);
  return {status:'recovered',requestId,pr:r.pr_number,deploymentId:finalLive};
 } catch(error) {
  if(claimed)await update('failed',`Recovery stopped in GitHub run ${runId}: ${error.message}. No merge, migration, deployment or alias mutation performed.`);
  throw error;
 }
}

export async function runRelease({api, fetcher = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), dryRun = false, credentialsOnly = false, previewRequestId = null, runId}) {
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
 requireThat(!previewRequestId || (dryRun && uuid(previewRequestId)), 'Preview requires dry run and a valid request ID');
 const rows = previewRequestId ? await db(`select l.* from public.chat_feature_releases l where l.request_id=${sql(previewRequestId)} and l.state in ('ready','approved')`) : await db(`select l.* from public.chat_feature_releases l where l.state='approved' and exists(select 1 from public.chat_feature_members m where m.account_id=l.approved_by and m.role='owner') and exists(select 1 from public.chat_feature_requests r where r.id=l.request_id and r.status='ready') and not exists(select 1 from public.chat_feature_releases where state in ('publishing','failed')) order by l.approved_at limit 1`);
 if (!rows.length) return {status:'idle'};
 const r = rows[0]; validateRelease(r, !!previewRequestId);
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
 const checkResult = await gh(`/commits/${r.head_sha}/check-runs?per_page=100`);
 requireThat(checkResult.total_count <= 100,'Too many checks');
 const statuses = await gh(`/commits/${r.head_sha}/status`);
 const protection = await gh('/branches/main/protection');
 requireThat(protection.enforce_admins?.enabled === true && protection.required_status_checks?.strict === true && protection.required_status_checks.contexts?.includes('Chat release checks'), 'Main must enforce up-to-date Chat release checks including administrators');
 const bypass = protection.required_pull_request_reviews?.bypass_pull_request_allowances;
 requireThat(!bypass || Object.values(bypass).every(entries => Array.isArray(entries) && entries.length === 0), 'Main must not allow release-actor bypass');
 validateChecks(checkResult.check_runs, statuses.statuses, r.head_sha);
 const check=checkResult.check_runs.find(c=>c.name==='Chat release checks'&&c.app?.slug==='github-actions'&&c.head_sha===r.head_sha);
 const details=check.details_url?.match(/^https:\/\/github\.com\/robbooker\/longboard\/actions\/runs\/(\d+)\/job\/(\d+)$/);
 requireThat(details,'Invalid integration job evidence');
 const run=await gh(`/actions/runs/${details[1]}`);
 requireThat(run.head_sha===r.head_sha && run.event==='pull_request' && run.path==='.github/workflows/chat-release-checks.yml' && run.conclusion==='success','Wrong validation workflow or revision');
 const job=await gh(`/actions/jobs/${details[2]}`);
 requireThat(String(job.run_id)===details[1] && job.conclusion==='success' && job.check_run_url?.endsWith(`/check-runs/${check.id}`),'Wrong validation job');
 const log=await gh(`/actions/jobs/${details[2]}/logs`);
 if(checkedOutCommit(log)!==integrationSha) throw new Waiting('Current integration needs fresh CI');
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
  const liveDeployment=await verifyLiveRelease({api,fetcher,plan,mergeSha:merged.sha,repoId:pr.base.repo.id});
  await update('published',`Published PR #${r.pr_number}; exact production commit, both live aliases and ${plan.probes.length} live probes verified. Run ${runId}.`,merged.sha,liveDeployment);
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
 const shared={api:apiClient(process.env),runId:process.env.GITHUB_RUN_ID,dryRun:process.env.RELEASE_DRY_RUN!=='false'};
 const recovery=process.env.RELEASE_RECOVERY_REQUEST||process.env.RELEASE_RECOVERY_MERGE;
 requireThat(!recovery || (!process.env.RELEASE_PREVIEW_REQUEST && process.env.RELEASE_CREDENTIALS_ONLY!=='true'),'Recovery cannot be combined with preview or credential checks');
 const task=recovery ? reconcileRelease({...shared,eventName:process.env.GITHUB_EVENT_NAME,requestId:process.env.RELEASE_RECOVERY_REQUEST,expectedMergeSha:process.env.RELEASE_RECOVERY_MERGE}) : runRelease({...shared,credentialsOnly:process.env.RELEASE_CREDENTIALS_ONLY==='true',previewRequestId:process.env.RELEASE_PREVIEW_REQUEST||null});
 task.then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
