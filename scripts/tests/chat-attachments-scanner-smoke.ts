import {scanAttachment} from '../../lib/chatMalwareScan';
async function main(){
const clean=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
await scanAttachment(clean,'image/gif');console.log('PASS clean GIF accepted');
const eicar=Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
let rejected=false;try{await scanAttachment(eicar,'application/octet-stream');}catch(e){rejected=e instanceof Error&&e.message.includes('did not pass');console.log('Scanner rejection:',e instanceof Error?e.message:'unknown');}
if(!rejected)throw Error('Antivirus test did not return an explicit rejection');
console.log('PASS harmless EICAR antivirus test rejected');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
