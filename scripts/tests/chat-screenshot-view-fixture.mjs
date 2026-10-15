// Synthetic PGlite + realtime protocol adapter. No production credentials/data.
// The shared chat fixture on this test's ports, so it keeps up with the app's migrations.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-screenshot-view-fixture-${process.pid}.mjs`,import.meta.url);
const source=(await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8')).replaceAll('54404','54414').replaceAll('3204','3214');
await writeFile(target,source);
try{await import(target.href);}finally{await unlink(target);}
