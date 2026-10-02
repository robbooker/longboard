import {describe,expect,it} from 'vitest';
import {chatSelfName} from '../chatMemberName';

const id='00000000-0000-4000-8000-000000000001';
const member={id,display_name:'Alice Baker',accepts_requests:true,name_revision:2};

describe('self author identity',()=>{
 it('uses the newest known name without regressing a newer supplied member',()=>{
  const renamed={...member,display_name:'Alice Fields',name_revision:3};
  expect(chatSelfName(id,member,renamed)).toBe('Alice Fields');
  expect(chatSelfName(id,renamed,member)).toBe('Alice Fields');
  expect(member.display_name).toBe('Alice Baker');
 });
 it('accepts the matching supplied or shared identity independently',()=>{
  expect(chatSelfName(id,member,null)).toBe('Alice Baker');
  expect(chatSelfName(id,null,member)).toBe('Alice Baker');
 });
 it('never takes a name from a different member or an unknown owner',()=>{
  const other={...member,id:'00000000-0000-4000-8000-000000000002',display_name:'Bob',name_revision:99};
  expect(chatSelfName(id,member,other)).toBe('Alice Baker');
  expect(chatSelfName(id,other,member)).toBe('Alice Baker');
  expect(chatSelfName(id,other,null)).toBeUndefined();
  expect(chatSelfName(undefined,member,member)).toBeUndefined();
  expect(chatSelfName(null,null,null)).toBeUndefined();
 });
 it('tolerates an old server without letting an omitted revision replace a newer name',()=>{
  const legacy={id,display_name:'Legacy Alice',accepts_requests:true};
  expect(chatSelfName(id,legacy,null)).toBe('Legacy Alice');
  expect(chatSelfName(id,member,legacy)).toBe('Alice Baker');
  expect(chatSelfName(id,legacy,member)).toBe('Alice Baker');
 });
});
