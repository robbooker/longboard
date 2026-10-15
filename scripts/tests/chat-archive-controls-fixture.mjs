// Synthetic PGlite + realtime protocol adapter. No production credentials/data.
// The shared chat fixture on this test's ports, so it keeps up with the app's migrations,
// plus 127 finished feature requests for the archive pages. They have no completion date, so the
// archive lists them by id; the two named ones get the highest ids so they land beyond the first 100.
import {readFile,writeFile,unlink} from 'node:fs/promises';
const target=new URL(`.chat-archive-controls-fixture-${process.pid}.mjs`,import.meta.url);
let source=(await readFile(new URL('chat-mobile-fixture.mjs',import.meta.url),'utf8')).replaceAll('54404','54414').replaceAll('3204','3214');
source=source.replace('caughtUp=true;',`caughtUp=true;
await db.exec(\`insert into chat_feature_requests(title,created_by,status) select 'Archived fixture '||n,'00000000-0000-4000-8000-000000000001','done' from generate_series(1,125) n;
insert into chat_feature_requests(id,title,created_by,status) values('ffffffff-ffff-4fff-bfff-fffffffffffe','Beyond100 unique archive','00000000-0000-4000-8000-000000000001','done'),('ffffffff-ffff-4fff-bfff-ffffffffffff','Literal 100%_exact','00000000-0000-4000-8000-000000000001','done');
update chat_feature_requests set created_at=now()-interval '2 days',priority_set_at=now()-interval '2 days';
update chat_feature_requests set created_at=now()-interval '1 day' where title in ('Beyond100 unique archive','Literal 100%_exact');\`);`);
await writeFile(target,source);
try{await import(target.href);}finally{await unlink(target);}
