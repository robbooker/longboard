import {describe,it,expect} from 'vitest';
import {quadChoices,validateQuadLayout} from '../chatQuad';
import type {DirectConversation} from '../chatDirectMessages';
const dm={id:'dm-1',otherId:'friend',otherName:'Friend',status:'accepted',blockedByMe:false,unavailable:false,system:false} as DirectConversation;
describe('quad choices and saved layout',()=>{
 it('lists only authorized rooms and usable existing DMs',()=>{expect(quadChoices(['main','gainers'],[dm,{...dm,id:'blocked',blockedByMe:true},{...dm,id:'gone',unavailable:true},{...dm,id:'no',status:'declined'},{...dm,id:'summary',system:true}]).map(c=>c.key)).toEqual(['room:main','room:gainers','dm:dm-1']);});
 it('removes duplicates, unauthorized rooms and expired conversations in place',()=>{expect(validateQuadLayout(['room:main','room:shortscout','dm:dm-1','room:main'],quadChoices(['main'],[dm]))).toEqual(['room:main','','dm:dm-1','']);});
 it('handles corrupt, oversized and missing saved data',()=>{const options=quadChoices(['main','gainers'],[]);for(const bad of [null,{},1,'room:main'])expect(validateQuadLayout(bad,options)).toEqual(['','','','']);expect(validateQuadLayout(['room:main',{},42,'room:gainers','dm:fake'],options)).toEqual(['room:main','','','room:gainers']);});
});
