import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {revealPinnedMessage} from '../chatPinnedMessageJump';
const element=(top:number)=>{
 const attrs=new Map<string,string>();
 return {scrollTop:20,clientTop:2,getBoundingClientRect:()=>({top}),getAttribute:(key:string)=>attrs.get(key)??null,setAttribute:(key:string,value:string)=>attrs.set(key,value),removeAttribute:(key:string)=>attrs.delete(key),focus:vi.fn()};
};
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('reveals within its own pane and temporarily makes the destination keyboard focusable',()=>{
 const pane=element(100),target=element(260),trigger=element(0);
 vi.stubGlobal('document',{hasFocus:()=>true,activeElement:trigger,querySelector:()=>null});
 revealPinnedMessage(pane as unknown as HTMLElement,target as unknown as HTMLElement,trigger as unknown as HTMLElement);
 expect(pane.scrollTop).toBe(178);expect(target.getAttribute('data-pin-highlight')).toBe('true');expect(target.getAttribute('tabindex')).toBe('-1');expect(target.focus).toHaveBeenCalledWith({preventScroll:true});
 vi.advanceTimersByTime(3000);expect(target.getAttribute('data-pin-highlight')).toBeNull();expect(target.getAttribute('tabindex')).toBeNull();
});
it.each(['composer','dialog','background'])('never steals focus from %s',state=>{
 const pane=element(100),target=element(260),trigger=element(0);
 vi.stubGlobal('document',{hasFocus:()=>state!=='background',activeElement:state==='composer'?{}:trigger,querySelector:()=>state==='dialog'?{}:null});
 const clear=revealPinnedMessage(pane as unknown as HTMLElement,target as unknown as HTMLElement,trigger as unknown as HTMLElement);
 expect(target.focus).not.toHaveBeenCalled();clear();expect(vi.getTimerCount()).toBe(0);
});
it('cancels obsolete emphasis without letting its old timer clear a repeated jump',()=>{
 const pane=element(100),target=element(260),trigger=element(0);target.setAttribute('tabindex','0');
 vi.stubGlobal('document',{hasFocus:()=>true,activeElement:trigger,querySelector:()=>null});
 const clear=revealPinnedMessage(pane as unknown as HTMLElement,target as unknown as HTMLElement,trigger as unknown as HTMLElement);
 vi.advanceTimersByTime(2500);clear();expect(target.getAttribute('tabindex')).toBe('0');
 revealPinnedMessage(pane as unknown as HTMLElement,target as unknown as HTMLElement,trigger as unknown as HTMLElement);
 vi.advanceTimersByTime(500);expect(target.getAttribute('data-pin-highlight')).toBe('true');vi.advanceTimersByTime(2500);expect(target.getAttribute('data-pin-highlight')).toBeNull();expect(target.getAttribute('tabindex')).toBe('0');
});
