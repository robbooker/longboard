#!/usr/bin/env node
// Runs the chat browser tests listed in browser-manifest.mjs: for each, a fresh synthetic fixture,
// a Next dev server pointed at it, then the test. Used by the "Chat browser tests" workflow.
//
//   node scripts/tests/run-browser-tests.mjs [options] [test names...]
//     --shard i/N      run only shard i of N (1-based), balanced by each test's weight
//     --offset N       shift every app/fixture port by N, so a run can sit beside another (local use)
//     --out DIR        logs and results.json (default /tmp/chat-browser-tests)
//     --retries N      re-run a failed test up to N times on a fresh fixture (default 0)
//     --list           print the plan and exit
//     --serve          start the first named test's fixture and dev server, print the test command,
//                      and keep them up until interrupted (for debugging one test)
//
// Exit code 1 when a test that is not quarantined fails. Only synthetic keys are used.
// Environment: CHAT_TIMING_SCALE multiplies the few timing budgets in the tests (CI sets 3);
// CHAT_AUTH_SOURCE_HANDLER points the ShortScout fixtures at a handler other than the vendored copy.
// Tests use /usr/bin/chromium; CI links the runner's Chrome there.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, appendFileSync, openSync, closeSync } from 'node:fs';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { PRESETS, TESTS } from './browser-manifest.mjs';

const root = resolve(new URL('../..', import.meta.url).pathname);
const dir = join(root, 'scripts/tests');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const [v] = args.splice(i, 2).slice(1); return v; };
const flag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const shard = opt('--shard', '1/1').split('/').map(Number);
const offset = Number(opt('--offset', process.env.OFF || 0));
const out = resolve(opt('--out', '/tmp/chat-browser-tests'));
const retries = Number(opt('--retries', 0));
const listOnly = flag('--list');
const serve = flag('--serve');
const only = new Set(args.map(a => a.replace(/-browser\.mjs$/, '').replace(/^(?!chat-)/, 'chat-')));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const src = f => readFileSync(join(dir, f), 'utf8');

// The shortscout membership-export handler lives in a sibling repo; CI uses the vendored copy.
process.env.CHAT_AUTH_SOURCE_HANDLER ||= new URL('./fixtures/shortscout-chat-membership-export-handler.ts', import.meta.url).href;

function plan(t) {
  const base = t.name, file = `${base}-browser.mjs`;
  if (t.variant) t = { ...t, test: base, name: `${base}:${t.variant}` };
  if (!existsSync(join(dir, file))) throw Error(`${t.name}: ${file} is missing`);
  const text = src(file);
  const fixture = t.fixture ?? (existsSync(join(dir, `${base}-fixture.mjs`)) ? `${base}-fixture.mjs` : 'shared');
  if (fixture === 'none') return { ...t, file, fixture };
  const app = t.app ?? Number(text.match(/localhost:(3\d{3})(?!\d)/)?.[1]);
  if (!app) throw Error(`${t.name}: no app port found`);
  const namedDb = Number(text.match(/127\.0\.0\.1:(5\d{4})(?!\d)/)?.[1]) || null;
  const db = t.db ?? namedDb ?? app + 51200;
  const preload = t.preload === false ? null : t.preload ?? (existsSync(join(dir, `${base}-preload.mjs`)) ? `${base}-preload.mjs` : null);
  return { ...t, file, fixture, app, db, preload, portEnv: t.portEnv ?? Boolean(namedDb && fixture !== 'shared') };
}

// Seconds each test took on CI (browser-weights.json, from a recent run's log), to balance the shards.
const WEIGHTS = existsSync(join(dir, 'browser-weights.json')) ? JSON.parse(src('browser-weights.json')) : {};
const all = TESTS.map(t => t.retired ? t : plan(t)).map(t => ({ ...t, weight: t.weight ?? WEIGHTS[t.name] ?? 45 }));
const selected = all.filter(t => !only.size || only.has(t.name) || only.has(t.test));
const runnable = selected.filter(t => !t.retired);
// Longest-first onto the lightest shard: deterministic, and every test lands on exactly one shard.
const loads = Array.from({ length: shard[1] }, () => ({ total: 0, tests: [] }));
for (const t of [...runnable].sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))) {
  const lightest = loads.reduce((a, b) => (b.total < a.total ? b : a));
  lightest.total += t.weight; lightest.tests.push(t);
}
const mine = loads[shard[0] - 1].tests.sort((a, b) => a.name.localeCompare(b.name));

if (listOnly) {
  for (const [i, l] of loads.entries()) console.log(`shard ${i + 1}/${shard[1]} (~${l.total}s): ${l.tests.map(t => t.name).join(' ')}`);
  for (const t of selected.filter(t => t.retired)) console.log(`retired ${t.name}: ${t.retired}`);
  process.exit(0);
}

// Port isolation (--offset): copy the test, fixture, preload and the local files they import to
// .iso<offset>-<name> with every port shifted. Text that a fixture reads from another fixture's
// source and then rewrites with replaceAll('<port>', …) keeps its original first argument.
const temp = new Set();
function localImports(text) {
  return [...text.matchAll(/(?:from\s*|import\s*\(?\s*)['"]\.\/([\w.-]+\.c?mjs|[\w.-]+\.cjs)['"]/g)].map(m => m[1]).filter(f => existsSync(join(dir, f)));
}
function isolate(files, offset) {
  if (!offset) return Object.fromEntries(files.map(f => [f, f]));
  const closure = [...files];
  for (let i = 0; i < closure.length; i++) for (const f of localImports(src(closure[i]))) if (!closure.includes(f)) closure.push(f);
  const ports = new Set(['3204', '54404']);
  for (const f of closure) {
    const s = src(f);
    for (const re of [/localhost:(\d{4})\b/g, /127\.0\.0\.1:(\d{5})\b/g, /listen\((\d{4,5})/g, /\|\|=?\s*'(3\d{3}|5\d{4})'/g, /\|\|\s*(3\d{3}|5\d{4})\b/g]) for (const m of s.matchAll(re)) ports.add(m[1]);
    for (const m of s.matchAll(/replaceAll\('(\d{4,5})','(\d{4,5})'\)/g)) { ports.add(m[1]); ports.add(m[2]); }
  }
  const names = Object.fromEntries(closure.map(f => [f, `.iso${offset}-${f}`]));
  const byLength = [...ports].sort((a, b) => b.length - a.length);
  for (const f of closure) {
    let s = src(f).replace(/replaceAll\('(\d{4,5})'([,"`])/g, (_, p, c) => `replaceAll('@@${p}@@'${c}`);
    for (const p of byLength) s = s.replace(new RegExp(`(?<![\\d@])${p}(?![\\d@])`, 'g'), String(Number(p) + offset));
    s = s.replace(/@@(\d+)@@/g, '$1');
    for (const [a, b] of Object.entries(names)) s = s.split(`./${a}`).join(`./${b}`);
    writeFileSync(join(dir, names[f]), s); temp.add(join(dir, names[f]));
  }
  return names;
}
function sharedFixture(t) {
  if (t.db === 54404 && t.app === 3204) return 'chat-mobile-fixture.mjs';
  const name = `.gen-${t.name}-fixture.mjs`;
  writeFileSync(join(dir, name), src('chat-mobile-fixture.mjs').replaceAll('54404', String(t.db)).replaceAll('3204', String(t.app)));
  temp.add(join(dir, name));
  return name;
}

const WARM = ['/chat/quad', '/chat/features', '/api/chat/activity', '/api/chat/history', '/api/chat/inbox', '/api/chat/thread',
  '/api/chat/thread-counts', '/api/chat/room-members', '/api/chat/message-pins', '/api/chat/pins', '/api/chat/mentions',
  '/api/chat/member', '/api/chat/reactions', '/api/chat/quad-options', '/api/chat/opening', '/api/chat/dm-members',
  '/api/chat/search', '/api/chat/features', '/api/chat/version', '/api/chat', '/api/chat/updates', '/api/chat/summary',
  '/api/chat/message', '/api/chat/message-reactions', '/api/chat/attachments', '/api/chat/timings'];
const children = new Set();
function start(command, argv, env, log) {
  const fd = openSync(log, 'a');
  const child = spawn(command, argv, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd], detached: true });
  closeSync(fd);
  child.exited = new Promise(r => child.on('exit', (code, signal) => r(code ?? (signal ? 128 : 1))));
  children.add(child); child.exited.then(() => children.delete(child));
  return child;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  if (await Promise.race([child.exited.then(() => true), sleep(5000).then(() => false)])) return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  await child.exited;
}
const listening = port => new Promise(r => { const s = connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); r(true); }); s.once('error', () => r(false)); });
async function until(check, seconds, alive) {
  for (let i = 0; i < seconds * 2; i++) { if (await check()) return true; if (alive && !alive()) return false; await sleep(500); }
  return false;
}
const alive = c => () => c.exitCode === null && c.signalCode === null;
const tail = (file, n = 40) => existsSync(file) ? readFileSync(file, 'utf8').split('\n').slice(-n).join('\n') : '';
async function fetchOk(url, ms) { try { await fetch(url, { signal: AbortSignal.timeout(ms) }); return true; } catch { return false; } }

function appEnv(t, dbPort, appPort, preload) {
  const env = { NEXT_PUBLIC_SITE_URL: `http://localhost:${appPort}`, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${dbPort}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-service-role', NEXT_TELEMETRY_DISABLED: '1' };
  const node = [];
  const presets = [...(t.env ?? [])];
  if (preload) {
    presets.push('membership');
    const p = src(preload);
    if (p.includes('scanner')) presets.push('scanner');
    if (p.includes('openai')) presets.push('openai');
  }
  for (const name of presets) {
    const { require, ...vars } = PRESETS[name] ?? (() => { throw Error(`${t.name}: unknown preset ${name}`); })();
    Object.assign(env, vars); if (require && !node.includes(`--require ${require}`)) node.push(`--require ${require}`);
  }
  if (preload) node.push(`--import ./scripts/tests/${preload}`);
  if (node.length) env.NODE_OPTIONS = node.join(' ');
  return env;
}

async function runOnce(t, base) {
  const logs = { test: `${base}.test.log`, fixture: `${base}.fixture.log`, dev: `${base}.dev.log` };
  for (const f of Object.values(logs)) rmSync(f, { force: true });
  // The debug preload saves a screenshot and the page text when a wait fails (see the file).
  const testEnv = { NODE_OPTIONS: ['--import ./scripts/tests/browser-debug-preload.mjs', t.testNodeOptions].filter(Boolean).join(' '), CHAT_BROWSER_DEBUG_DIR: `${base}.debug` };
  rmSync(`${base}.debug`, { recursive: true, force: true });
  const timeout = (t.timeout ?? 240) * 1000;
  const runTest = async file => {
    const child = start(process.execPath, [`scripts/tests/${file}`, ...(t.args ?? [])], testEnv, logs.test);
    const code = await Promise.race([child.exited, sleep(timeout).then(() => 'timeout')]);
    if (code === 'timeout') { await stop(child); appendFileSync(logs.test, `\n[runner] timed out after ${timeout / 1000}s\n`); return 124; }
    return code;
  };
  // Next refuses a few ports (4045, 6000, ...); move a test whose shifted app port is one of them a little further.
  const off = offset && [4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697].includes((t.app ?? 0) + offset) ? offset + 10 : offset;
  if (t.fixture === 'none') { const names = isolate([t.file], off); return { code: await runTest(names[t.file]) }; }
  const fixtureFile = t.fixture === 'shared' ? sharedFixture(t) : t.fixture;
  const names = isolate([fixtureFile, t.file, ...(t.preload ? [t.preload] : [])], off);
  const app = t.app + off, db = t.db + off;
  let fixture, dev;
  try {
    // Another run on this machine may hold a port for a moment; wait for it rather than fail.
    for (let tries = 0; ; tries++) {
      if (!await until(async () => !(await listening(app)) && !(await listening(db)), 60)) return { code: 1, error: `port ${app} or ${db} is already in use` };
      fixture = start(process.execPath, [`scripts/tests/${names[fixtureFile]}`], t.portEnv ? { CHAT_FIXTURE_PORT: String(db), CHAT_APP_PORT: String(app) } : {}, logs.fixture);
      if (await until(() => listening(db), 180, alive(fixture))) break;
      await stop(fixture);
      if (tries < 2 && tail(logs.fixture).includes('EADDRINUSE')) { await sleep(10000); continue; }
      return { code: 1, error: `fixture did not listen on ${db}` };
    }
    dev = start(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--port', String(app)], appEnv(t, db, app, t.preload && names[t.preload]), logs.dev);
    if (!await until(() => fetchOk(`http://localhost:${app}/login`, 120000), 240, alive(dev))) return { code: 1, error: 'Next dev server did not start' };
    // Compile the chat pages and the read routes before the test's clock starts: a dev server
    // compiles each route on its first request, which on CI can outlast a test's short waits.
    // Signed-out GETs only (a POST-only route answers 405), so nothing is written.
    await fetchOk(`http://localhost:${app}/chat`, 180000);
    const warm = [...WARM];
    await Promise.all([0, 1, 2].map(async () => { for (let path; (path = warm.shift());) await fetchOk(`http://localhost:${app}${path}`, 120000); }));
    if (serve) { console.log(`serving: NODE_OPTIONS='${testEnv.NODE_OPTIONS}' CHAT_BROWSER_DEBUG_DIR=${testEnv.CHAT_BROWSER_DEBUG_DIR} node scripts/tests/${names[t.file]}`); await new Promise(() => {}); }
    return { code: await runTest(names[t.file]) };
  } finally {
    await stop(dev); await stop(fixture);
    // Fixtures built on another fixture write a .<name>-<pid>.mjs copy and remove it on exit; a stopped one cannot.
    if (fixture) for (const f of readdirSync(dir)) if (f.startsWith('.') && f.endsWith(`-${fixture.pid}.mjs`)) rmSync(join(dir, f), { force: true });
    await until(async () => !(await listening(app)) && !(await listening(db)), 20);
  }
}

mkdirSync(out, { recursive: true });
const cleanup = () => { for (const f of temp) rmSync(f, { force: true }); };
const abort = async () => { for (const c of [...children]) await stop(c); cleanup(); process.exit(130); };
process.on('SIGINT', abort); process.on('SIGTERM', abort);

const results = [];
console.log(`shard ${shard.join('/')}: ${mine.length} tests${offset ? `, ports +${offset}` : ''}; logs in ${out}`);
for (const t of mine) {
  const started = Date.now();
  let r, base, attempt = 0;
  for (; attempt <= retries; attempt++) {
    const file = t.name.replace(':', '--'); // artifact uploads refuse ':' in file names
    base = join(out, attempt ? `${file}.retry${attempt}` : file);
    r = await runOnce(t, base);
    if (r.code === 0) break;
    if (attempt < retries) {
      const why = tail(`${base}.test.log`, 400).split('\n').filter(l => /Error|assert|browser\.mjs:\d+/.test(l) && !l.includes('node_modules')).slice(0, 4).join('\n    ');
      console.log(`  ${t.name} failed (exit ${r.code}${r.error ? `: ${r.error}` : ''}); retrying on a fresh fixture\n    ${why}`);
    }
  }
  const passed = r.code === 0;
  const status = passed ? (attempt ? 'flaky' : 'pass') : t.quarantine ? 'quarantined-fail' : 'fail';
  const seconds = Math.round((Date.now() - started) / 1000);
  results.push({ name: t.name, status, exit: r.code, error: r.error, seconds, quarantine: t.quarantine });
  console.log(`${status.padEnd(16)} ${t.name} (${seconds}s)${r.error ? ` ${r.error}` : ''}`);
  if (!passed) {
    console.log(`::group::${t.name} logs\n--- test\n${tail(`${base}.test.log`)}\n--- fixture\n${tail(`${base}.fixture.log`, 15)}\n--- next dev\n${tail(`${base}.dev.log`, 25)}\n::endgroup::`);
  }
}
cleanup();
const retired = selected.filter(t => t.retired).map(t => ({ name: t.name, status: 'retired', reason: t.retired }));
writeFileSync(join(out, 'results.json'), JSON.stringify({ shard, results, retired: shard[0] === 1 ? retired : [] }, null, 1));
const failed = results.filter(r => r.status === 'fail');
const lines = [`### Chat browser tests, shard ${shard.join('/')}`, '', '| Test | Result | Time |', '|---|---|---|',
  ...results.map(r => `| ${r.name} | ${r.status}${r.quarantine ? ` (quarantined: ${r.quarantine})` : ''} | ${r.seconds}s |`),
  ...(shard[0] === 1 ? retired.map(r => `| ${r.name} | retired: ${r.reason} | |`) : []), ''];
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
console.log(`\n${results.filter(r => r.status === 'pass' || r.status === 'flaky').length} passed, ${failed.length} failed, ${results.filter(r => r.status === 'quarantined-fail').length} quarantined failures`);
process.exit(failed.length ? 1 : 0);
