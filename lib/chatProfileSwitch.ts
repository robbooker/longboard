/** Ordered local-browser switch: stop on any failure, never continue as the wrong actor. */
export async function switchToShortScoutProfile(actions:{disablePush:()=>Promise<void>;logoutChat:()=>Promise<void>;logoutLongboard:()=>Promise<void>;clear:()=>void;navigate:()=>void}){
 await actions.disablePush();
 await actions.logoutChat();
 await actions.logoutLongboard();
 actions.clear();
 actions.navigate();
}
