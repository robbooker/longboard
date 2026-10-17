#!/usr/bin/env node
// First-load JavaScript per app route, from a finished `next build` (.next/app-build-manifest.json).
// Counts what Next's build table counts: the gzipped .js files of the page entry plus every layout
// above it (CSS and the nomodule polyfills are left out). Sizes are bytes; Next's table shows kB = 1000 bytes.
//
//   node scripts/size/route-sizes.mjs [--dir .next] [--all] [--out sizes.json]
// Without --all, only the routes in scripts/size/chat-size-budget.json are measured.
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const dir = resolve(opt('--dir', '.next'));
const outFile = opt('--out', null);
const budget = JSON.parse(readFileSync(new URL('./chat-size-budget.json', import.meta.url), 'utf8'));
const pages = JSON.parse(readFileSync(join(dir, 'app-build-manifest.json'), 'utf8')).pages;

const gz = new Map();
const size = f => { if (!gz.has(f)) gz.set(f, gzipSync(readFileSync(join(dir, f)), { level: 9 }).length); return gz.get(f); };
// "/chat/quad" -> page entry "/chat/quad/page" and layouts "/layout", "/chat/layout", "/chat/quad/layout".
function entries(route) {
  const parts = route === '/' ? [] : route.split('/').slice(1);
  const layouts = ['/layout', ...parts.map((_, i) => `/${parts.slice(0, i + 1).join('/')}/layout`)];
  return [...layouts.filter(l => pages[l]), `${route === '/' ? '' : route}/page`];
}
function measure(route) {
  const keys = entries(route);
  if (!pages[keys.at(-1)]) return null;
  const files = [...new Set(keys.flatMap(k => pages[k]))].filter(f => f.endsWith('.js'));
  const page = pages[keys.at(-1)].filter(f => f.endsWith('.js') && f.includes('/app/'));
  return { firstLoad: files.reduce((n, f) => n + size(f), 0), page: page.reduce((n, f) => n + size(f), 0), files: files.length };
}
const routes = args.includes('--all')
  ? Object.keys(pages).filter(k => k.endsWith('/page') && !k.startsWith('/api/')).map(k => k.slice(0, -5) || '/')
  : budget.routes;
const result = {};
for (const r of routes) { const m = measure(r); if (m) result[r] = m; }
const json = JSON.stringify(result, null, 1);
if (outFile) writeFileSync(outFile, json + '\n'); else console.log(json);
