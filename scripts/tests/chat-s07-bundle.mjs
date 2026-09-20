// Measure actual Next production manifests and bytes, without changing build configuration.
// Usage: node scripts/tests/chat-s07-bundle.mjs BEFORE_ROOT AFTER_ROOT OUTPUT_PREFIX
import {readFile,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
const [beforeRoot,afterRoot,outputPrefix='docs/chat-s07-bundle-results']=process.argv.slice(2);
if(!beforeRoot||!afterRoot)throw Error('Expected BEFORE_ROOT AFTER_ROOT [OUTPUT_PREFIX]');
async function measure(root){
 const next=path.join(root,'.next');
 const manifest=JSON.parse(await readFile(path.join(next,'app-build-manifest.json'),'utf8'));
 const routeKeys=['/layout','/chat/layout','/chat/page'].filter(key=>manifest.pages[key]);
 if(!routeKeys.includes('/chat/page'))throw Error('Missing production /chat/page manifest');
 const files=[...new Set(routeKeys.flatMap(key=>manifest.pages[key]))].filter(file=>file.endsWith('.js'));
 const fileRows=await Promise.all(files.map(async file=>{const body=await readFile(path.join(next,file));return {file,bytes:body.length,gzipBytes:gzipSync(body).length,routes:routeKeys.filter(key=>manifest.pages[key].includes(file))};}));
 const loadable=JSON.parse(await readFile(path.join(next,'react-loadable-manifest.json'),'utf8'));
 const deferred=[];
 for(const [module,entry] of Object.entries(loadable))if(/Pedro|PublicChat|RoomMember|StartDirect|ChatSearch|ThreadPanel|FeatureNotification|Admin|Summary|Favorite/.test(module)){
  const chunks=await Promise.all(entry.files.filter(file=>file.endsWith('.js')).map(async file=>{const body=await readFile(path.join(next,file));return {file,bytes:body.length,gzipBytes:gzipSync(body).length,initial:files.includes(file)};}));deferred.push({module,chunks});
 }
 return {root,buildId:(await readFile(path.join(next,'BUILD_ID'),'utf8')).trim(),routeKeys,initialJs:{bytes:fileRows.reduce((sum,r)=>sum+r.bytes,0),gzipBytes:fileRows.reduce((sum,r)=>sum+r.gzipBytes,0),files:fileRows},deferred};
}
const before=await measure(path.resolve(beforeRoot)),after=await measure(path.resolve(afterRoot));
const kib=n=>(n/1024).toFixed(2),delta={bytes:after.initialJs.bytes-before.initialJs.bytes,gzipBytes:after.initialJs.gzipBytes-before.initialJs.gzipBytes};
const report=`# S07 production chat bundle comparison\n\nBaseline source: \`592b7f4\`, frozen snapshot. After: current S07 working tree. Both run the installed Next.js production build with the same dependency directory and synthetic public configuration. Build IDs: before \`${before.buildId}\`, after \`${after.buildId}\`.\n\nThe initial set is the deduplicated JavaScript union of \`${before.routeKeys.join('`, `')}\` from Next's app-build-manifest. Sizes are actual emitted files; gzip uses Node's default gzip settings per file. This is a build-artifact measurement, not a claim about browser transferred bytes, parse time, execution time, or paint. Dynamic chunks may still load during hydration or on interaction; the browser trace is reported separately if available.\n\n| Initial chat JS | Before | After | Change |\n|---|---:|---:|---:|\n| Uncompressed KiB | ${kib(before.initialJs.bytes)} | ${kib(after.initialJs.bytes)} | ${kib(delta.bytes)} |\n| Per-file gzip KiB | ${kib(before.initialJs.gzipBytes)} | ${kib(after.initialJs.gzipBytes)} | ${kib(delta.gzipBytes)} |\n| Files | ${before.initialJs.files.length} | ${after.initialJs.files.length} | ${after.initialJs.files.length-before.initialJs.files.length} |\n\n${[ ['Before',before],['After',after] ].map(([label,m])=>`## ${label} initial chunks\n\n| File | KiB | gzip KiB |\n|---|---:|---:|\n${m.initialJs.files.map(f=>`| \`${f.file}\` | ${kib(f.bytes)} | ${kib(f.gzipBytes)} |`).join('\n')}\n`).join('\n')}\n## Deferred module records\n\n${[ ['Before',before],['After',after] ].map(([label,m])=>`### ${label}\n\n${m.deferred.length?m.deferred.map(row=>`- \`${row.module}\`: ${row.chunks.map(c=>`\`${c.file}\` (${kib(c.gzipBytes)} KiB gzip${c.initial?', also initial':''})`).join(', ')}`).join('\n'):'No matching loadable records.'}`).join('\n\n')}\n\nRaw bytes, chunk mappings, and exact build paths are in the adjacent JSON report. Run: \`node scripts/tests/chat-s07-bundle.mjs BEFORE_ROOT AFTER_ROOT OUTPUT_PREFIX\`.\n`;
await writeFile(outputPrefix+'.json',JSON.stringify({before,after,delta},null,2)+'\n');await writeFile(outputPrefix+'.md',report);console.log(report);
