import {describe,it,expect} from 'vitest';
import {isKeyboardDismissSwipe,isKeyboardDismissTap} from '../chatKeyboardDismiss';
describe('touch keyboard dismissal intent',()=>{
 it.each([[0,40],[12,60],[-12,60]])('accepts downward swipe %s,%s',(x,y)=>expect(isKeyboardDismissSwipe(x,y)).toBe(true));
 it.each([[0,39],[0,-100],[50,40],[-50,40],[40,0]])('ignores small, upward and sideways motion %s,%s',(x,y)=>expect(isKeyboardDismissSwipe(x,y)).toBe(false));
 it('accepts only a short stationary tap, including small finger jitter',()=>{
  expect(isKeyboardDismissTap(0,100)).toBe(true);expect(isKeyboardDismissTap(10,500)).toBe(true);
  expect(isKeyboardDismissTap(11,100)).toBe(false);expect(isKeyboardDismissTap(0,501)).toBe(false);
 });
});
