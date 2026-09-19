import {describe,it,expect} from 'vitest';
import {ChatDmCache,type DmSnapshot} from '../chatDmCache';
const snapshot=(draft='draft'):DmSnapshot=>({messages:[],hasMore:true,draft,scrollTop:123});
describe('private DM snapshot cache',()=>{
 it('restores text/scroll and evicts least recently used conversations',()=>{const c=new ChatDmCache('a',2);c.put('a','1',snapshot());c.put('a','2',snapshot());expect(c.get('a','1')?.scrollTop).toBe(123);c.put('a','3',snapshot());expect(c.get('a','2')).toBeUndefined();expect(c.get('a','1')?.draft).toBe('draft');});
 it('expires even when frequently read',()=>{const c=new ChatDmCache('a',6,100);c.put('a','1',snapshot(),0);expect(c.get('a','1',99)).toBeDefined();expect(c.get('a','1',100)).toBeUndefined();});
 it('clears private data on identity change and access loss',()=>{const c=new ChatDmCache('a');c.put('a','1',snapshot());expect(c.get('b','1')).toBeUndefined();expect(c.get('a','1')).toBeUndefined();c.put('a','1',snapshot());c.put('a','2',snapshot());c.retain(new Set(['2']));expect(c.get('a','1')).toBeUndefined();c.delete('2');expect(c.get('a','2')).toBeUndefined();});
});
