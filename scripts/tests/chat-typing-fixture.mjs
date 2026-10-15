// Synthetic chat fixture for the typing indicator (no live accounts or credentials): the mobile
// fixture on its own ports. Realtime is faked inside the browser by chat-typing-browser.mjs.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-typing-fixture-${process.pid}.mjs`,import.meta.url);
const source=(await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8')).replaceAll('54404','54590').replaceAll('3204','3390');
await writeFile(target,source);try{await import(target.href);}finally{await unlink(target);}
