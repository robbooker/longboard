const HIDDEN_PATHS=['/login','/thanks','/invite','/charts','/alert','/chat','/command2/chat'];
export function isPedroHiddenPath(pathname:string){
 return HIDDEN_PATHS.some(path=>pathname===path||pathname.startsWith(`${path}/`));
}
