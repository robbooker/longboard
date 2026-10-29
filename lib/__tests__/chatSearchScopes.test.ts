import {describe,it,expect} from 'vitest';
import {chatSearchScopes,chatSearchScopeRooms} from '@/lib/chatSearchScopes';
describe('exact room search scopes',()=>{
 it.each([
  [[],[]],
  [['social'],['social']],
  [['main','social'],['main','social','lb-social']],
  [['shortscout','social'],['shortscout','social','ss-social']],
  [['main','social','shortscout','gainers'],['main','shortscout','social','lb-social','ss-social']],
  [['social','gainers','whats-new','developers'],['social','developers']],
  [['main','social','shortscout','gainers','whats-new','developers'],['main','shortscout','social','lb-social','ss-social','developers']],
 ] as const)('shows only complete permitted scopes %j',(rooms,values)=>expect(chatSearchScopes(rooms).map(s=>s.value)).toEqual(values));
 it('never expands either pair to all three rooms or other surfaces',()=>{
  expect(chatSearchScopeRooms('lb-social')).toEqual(['main','social']);expect(chatSearchScopeRooms('ss-social')).toEqual(['shortscout','social']);
  for(const scope of ['all','dm','gainers','ss-announcements','main,shortscout','whats-new'])expect(chatSearchScopeRooms(scope)).toBeNull();
 });
 it('#322 Developers is its own scope and never joins another',()=>{
  expect(chatSearchScopeRooms('developers')).toEqual(['developers']);
  for(const scope of ['main','social','lb-social','ss-social'])expect(chatSearchScopeRooms(scope)).not.toContain('developers');
 });
});
