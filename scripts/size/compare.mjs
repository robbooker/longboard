#!/usr/bin/env node
// Compares two route-sizes.mjs results (main vs this branch) against scripts/size/chat-size-budget.json.
// Prints a Markdown table (also to $GITHUB_STEP_SUMMARY and --md FILE); exits 1 when a route grew
// past its budget: more than max(growthPercent% of main, growthBytes).
//   node scripts/size/compare.mjs base.json head.json [--md comment.md]
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const [baseFile, headFile] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const mdIdx = process.argv.indexOf('--md');
const mdFile = mdIdx > 0 ? process.argv[mdIdx + 1] : null;
const budget = JSON.parse(readFileSync(new URL('./chat-size-budget.json', import.meta.url), 'utf8'));
const base = existsSync(baseFile) ? JSON.parse(readFileSync(baseFile, 'utf8')) : {};
const head = JSON.parse(readFileSync(headFile, 'utf8'));
const kb = n => `${(n / 1000).toFixed(1)} kB`;
const signed = n => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${(Math.abs(n) / 1000).toFixed(1)} kB`;

const rows = [], over = [];
for (const route of budget.routes) {
  const h = head[route], b = base[route];
  if (!h) { rows.push(`| \`${route}\` | – | ${b ? kb(b.firstLoad) : '–'} | route not built on this branch | |`); continue; }
  if (!b) { rows.push(`| \`${route}\` | ${kb(h.firstLoad)} | – | new route | |`); continue; }
  const diff = h.firstLoad - b.firstLoad;
  const allowed = Math.max(b.firstLoad * budget.growthPercent / 100, budget.growthBytes);
  const pct = b.firstLoad ? (100 * diff / b.firstLoad).toFixed(1) : '0';
  const bad = diff > allowed;
  if (bad) over.push(route);
  rows.push(`| \`${route}\` | ${kb(h.firstLoad)} | ${kb(b.firstLoad)} | ${signed(diff)} (${diff >= 0 ? '+' : ''}${pct}%) | ${bad ? `❌ over budget (+${kb(allowed)} allowed)` : '✅'} |`);
}
const md = [
  '<!-- chat-size-budget -->',
  '### Chat size budget',
  '',
  'JavaScript a phone downloads to open each chat route (first load, gzipped: the page plus its layouts and the shared framework).',
  '',
  '| Route | This branch | main | Change | Budget |',
  '|---|---|---|---|---|',
  ...rows,
  '',
  `Budget: a route may grow by ${budget.growthPercent}% or ${kb(budget.growthBytes)}, whichever is larger (scripts/size/chat-size-budget.json).` +
    (Object.keys(base).length ? '' : ' main was not measured, so nothing is compared.'),
  over.length ? `\n**Over budget:** ${over.map(r => `\`${r}\``).join(', ')}. Trim the new code, load it lazily (\`next/dynamic\`), or raise the budget in the JSON file with a reason in the PR.` : '',
].join('\n') + '\n';
console.log(md);
if (mdFile) writeFileSync(mdFile, md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
process.exit(over.length ? 1 : 0);
