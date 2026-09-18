// Isolated authentication fixture. Approval responses are intercepted by the browser test.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.approvals-top-fixture-${process.pid}.mjs`,import.meta.url);
const source=(await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8')).replaceAll('54404','54476').replaceAll('3204','3276');
await writeFile(target,source);try{await import(target.href);}finally{await unlink(target);}
