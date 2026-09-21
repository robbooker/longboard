import {describe,it,expect,vi} from 'vitest';
import {switchToShortScoutProfile} from '@/lib/chatProfileSwitch';
import {chatLoginRecoveryMessage,chatLoginRecoveryReason} from '@/lib/chatLoginRecovery';
describe('explicit local profile switch',()=>{
 it('disables local push, logs out both identities then clears cache and navigates',async()=>{
  const calls:string[]=[];await switchToShortScoutProfile({disablePush:async()=>{calls.push('push')},logoutChat:async()=>{calls.push('chat')},logoutLongboard:async()=>{calls.push('lb')},clear:()=>{calls.push('clear')},navigate:()=>{calls.push('navigate')}});expect(calls).toEqual(['push','chat','lb','clear','navigate']);
 });
 it.each(['disablePush','logoutChat','logoutLongboard'] as const)('never clears drafts or navigates after %s fails',async step=>{
  const actions={disablePush:vi.fn().mockResolvedValue(undefined),logoutChat:vi.fn().mockResolvedValue(undefined),logoutLongboard:vi.fn().mockResolvedValue(undefined),clear:vi.fn(),navigate:vi.fn()};actions[step].mockRejectedValue(Error('failed'));
  await expect(switchToShortScoutProfile(actions)).rejects.toThrow('failed');expect(actions.clear).not.toHaveBeenCalled();expect(actions.navigate).not.toHaveBeenCalled();
 });
 it('never renders an arbitrary callback error',()=>{expect(chatLoginRecoveryReason('<script>secret</script>')).toBe('invalid_login_handoff');expect(chatLoginRecoveryMessage('<script>secret</script>')).not.toContain('script');});
});
