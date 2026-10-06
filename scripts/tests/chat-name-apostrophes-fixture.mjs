// Current published synthetic SQL/Auth fixture plus this ticket's exact migration.
import {readFile,writeFile,unlink} from 'node:fs/promises';
process.env.CHAT_FIXTURE_PORT||='54576';process.env.CHAT_APP_PORT||='3376';
const target=new URL(`.chat-name-apostrophes-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-ss-search-fixture.mjs',import.meta.url),'utf8');
source=source.replace("'20261006134004_chat_shortscout_search.sql'","'20261006134004_chat_shortscout_search.sql','20261006145455_chat_name_apostrophes.sql'");
await writeFile(target,source);try{await import(target.href);}finally{await unlink(target);}
