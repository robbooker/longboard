import {describe,it,expect} from 'vitest';
import {chatSearchScopes,chatSearchScopeRooms} from '@/lib/chatSearchScopes';
describe('exact room search scopes',()=>{
 it.each([
  [[],[]],
  [['social'],['social']],
  [['main','social'],['main','social','lb-social']],
  [['shortscout','social'],['shortscout','social','ss-social']],
  [['main','social','shortscout','gainers'],['main','shortscout','social','lb-social','ss-social']],
 ] as const)('shows only complete permitted scopes %j',(rooms,values)=>expect(chatSearchScopes(rooms).map(s=>s.value)).toEqual(values));
 it('never expands either pair to all three rooms or other surfaces',()=>{
  expect(chatSearchScopeRooms('lb-social')).toEqual(['main','social']);expect(chatSearchScopeRooms('ss-social')).toEqual(['shortscout','social']);
  for(const scope of ['all','dm','gainers','ss-announcements','main,shortscout'])expect(chatSearchScopeRooms(scope)).toBeNull();
 });
});
