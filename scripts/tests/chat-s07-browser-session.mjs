// Synthetic local fixture only. Avoid cross-origin browser login affecting cold-chat metrics.
export async function prepareChatSession(page,base,fixture='http://127.0.0.1:54478'){
 const response=await fetch(fixture+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'alice@example.test',password:'demo-only'})});
 if(!response.ok)throw Error('Synthetic fixture login unavailable');
 const session=await response.json();session.expires_at=Math.floor(Date.now()/1000)+session.expires_in;
 const project=new URL(fixture).hostname.split('.')[0];
 await page.setCookie({name:`sb-${project}-auth-token`,value:'base64-'+Buffer.from(JSON.stringify(session)).toString('base64url'),url:base,path:'/',sameSite:'Lax'});
 return session.user.id;
}
