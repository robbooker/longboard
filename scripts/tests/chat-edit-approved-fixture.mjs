// Synthetic PGlite + realtime protocol adapter. No production credentials/data.
// The shared chat fixture on this test's ports, so it keeps up with the app's migrations.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-edit-approved-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8');
source=source.replaceAll('54404','54463').replaceAll('3204','3263');
// Feature lists page with offset.
source=source.replace("['select','limit','order','on_conflict']","['select','limit','offset','order','on_conflict']");
source=source.replace("   if(url.searchParams.has('limit'))","   if(url.searchParams.has('offset'))sql+=' offset '+bind(Number(url.searchParams.get('offset')));\n   if(url.searchParams.has('limit'))");
await writeFile(target,source);
try{await import(target.href);}finally{await unlink(target);}
