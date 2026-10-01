// Reuse the current auth/activity protocol fixture with synthetic data only.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-pinned-unread-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-shortscout-authorization-fixture.mjs',import.meta.url),'utf8');
// Pins exercise existing LB principals; the external ShortScout source companion
// and its transport controls are unnecessary. Keep this fixture self-contained.
source=source.replace(/const \{membershipExportHandler\}=[\s\S]*?\nawait db.query/, 'await db.query');
source=source.replace(/\n if\(url.pathname==='\/test\/source'\)\{[\s\S]*?\n \}/, '');
source=source.replace(/\n if\(url.pathname==='\/test\/membership-export'\)\{[\s\S]*?\n \}/, '');
source=source.replaceAll("||'54555'","||'54557'").replaceAll("||'3355'","||'3357'");
source=source.replace("'20261001190002_chat_shortscout_authorization.sql'","'20261001190002_chat_shortscout_authorization.sql','20261001191605_chat_pinned_unread.sql'");
source=source.replace("source=source.replaceAll('54404'",`source=source.replace("now()+($3 * interval '1 second')","now()-interval '1 day'+($3 * interval '1 second')");\nsource=source.replaceAll('54404'`);
source=source.replace("return send((await db.query(payload.sql,payload.args||[])).rows);","const rows=(await db.query(payload.sql,payload.args||[])).rows;if(payload.broadcast)for(const row of rows)broadcast(payload.broadcast,row);return send(rows);");
await writeFile(target,source);try{await import(target.href);}finally{await unlink(target);}
