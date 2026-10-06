import {expect,it} from 'vitest';
import {chatName} from '../chatDisplayName';
import {newerChatMember,validChatMember} from '../chatMemberName';
import {CHAT_UUID} from '../chatMembers';
const id='00000000-0000-4000-8000-000000000001';
const member={id,display_name:'Alice Baker',accepts_requests:true,name_revision:2};
it('normalizes names while accepting Unicode, punctuation and ordinary substrings',()=>{
 expect(chatName('  Ａnne-Marie   O\'Neill  ')).toBe("Anne-Marie O'Neill");
 for(const name of ['José Li','李 小明','Scunthorpe','Dick Smith','Ashit Patel','Rob','Jammie'])expect(chatName(name)).toBe(name);
});
it.each(["O'Neill",'O’Neill','O‘Neill','D’Arcy','Anne O’Neill'])('preserves the apostrophe glyph in %s',name=>expect(chatName(name)).toBe(name));
it('keeps punctuation boundaries and unsafe characters rejected',()=>{
 for(const name of ['’Anne','‘Anne',"'Anne",'Anne`Marie','Anne“Marie','Anne\\Marie','Anne<svg>','Trader’SHIT','Fuck‘Trader'])expect(chatName(name)).toBeNull();
});
it('rejects empty, malformed, reserved and explicit inappropriate whole words',()=>{
 for(const name of [null,{},'', ' ', 'A','a'.repeat(29),'<script>','a@example.test','Buddy','ＬＯＮＧＢＯＡＲＤ ADMIN','Fuck Trader','Trader_SHIT'])expect(chatName(name)).toBeNull();
});
it('retains the last accepted name through old-server omission and out-of-order save replies',()=>{
 expect(newerChatMember(member,{...member,display_name:'Old',name_revision:1})).toBe(member);
 expect(newerChatMember(member,{id,display_name:'Legacy',accepts_requests:true})).toBe(member);
 expect(newerChatMember(member,{...member,id:'00000000-0000-4000-8000-000000000002',name_revision:99})).toBe(member);
 expect(newerChatMember(member,{...member,display_name:'Alice New',name_revision:3}).display_name).toBe('Alice New');
 expect(validChatMember(member)).toBe(true);expect(validChatMember({...member,name_revision:-1})).toBe(false);expect(CHAT_UUID.test(id)).toBe(true);
});
