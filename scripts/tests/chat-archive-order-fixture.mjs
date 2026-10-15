// Current local-only schema/auth adapter; all accounts and data are synthetic.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-archive-order-fixture-${process.pid}.mjs`,import.meta.url);
let source=await readFile(new URL('chat-shortscout-authorization-fixture.mjs',import.meta.url),'utf8');
source=source.replaceAll("||'54555'","||'54559'").replaceAll("||'3355'","||'3359'");
source=source.replace("'20261001190002_chat_shortscout_authorization.sql'","'20261001190002_chat_shortscout_authorization.sql','20261001191605_chat_pinned_unread.sql','20261002120756_chat_member_display_names.sql','20260917205526_chat_archive_declined.sql','20260918134410_chat_edit_approved_request.sql','20260928120621_chat_jammie_development_approval.sql','20261002125758_chat_feature_archive_order.sql'");
await writeFile(target,source);try{await import(target.href);}finally{await unlink(target);}
