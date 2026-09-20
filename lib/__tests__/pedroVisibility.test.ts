import {expect,it} from 'vitest';
import {isPedroHiddenPath} from '../pedroVisibility';
it('excludes chat/login routes and descendants without hiding similarly named routes',()=>{
 for(const path of ['/chat','/chat/features','/chat/login','/login','/login/forgot','/thanks','/invite/a','/charts','/alert/a','/command2/chat'])expect(isPedroHiddenPath(path)).toBe(true);
 for(const path of ['/','/scanner','/chatting','/alerts','/command2'])expect(isPedroHiddenPath(path)).toBe(false);
});
