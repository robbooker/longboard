// Node-only preload for isolated browser tests. Never load in a deployment.
if (process.env.CHAT_TEST_SCANNER === 'isolated-fixture') {
 const original=globalThis.fetch;
 globalThis.fetch=async (url,init)=>{
  if(String(url)==='https://api2.transloadit.com/assemblies'){
   const file=init.body.get('file'),bytes=Buffer.from(await file.arrayBuffer());
   await new Promise(resolve=>setTimeout(resolve,700));
   if(bytes.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')))return Response.json({error:'VIRUS_DETECTED',assembly_ssl_url:'https://api2.transloadit.com/assemblies/00000000000000000000000000000000'});
   return Response.json({ok:'ASSEMBLY_COMPLETED',uploads:[{id:'fixture-file'}],results:{scanned:[{original_id:'fixture-file'}]}});
  }
  return original(url,init);
 };
}
