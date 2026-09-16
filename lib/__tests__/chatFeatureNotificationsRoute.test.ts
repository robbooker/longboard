import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ access: vi.fn(), calls: [] as Array<{table:string;steps:Array<[string,unknown[]]>}>, failure: false }));
vi.mock('@/lib/chatFeatures', () => ({ featureAccess: mocks.access }));
import { GET, POST } from '@/app/api/chat/features/notifications/route';
import { defaultNotificationPreferences } from '@/lib/chatFeatureNotifications';
const owner='00000000-0000-4000-8000-000000000001';
const notification='00000000-0000-4000-8000-000000000004';
function from(table:string) {
 const call={table,steps:[] as Array<[string,unknown[]]>};mocks.calls.push(call);
 const chain:Record<string,unknown>={};
 for(const method of ['select','eq','is','order','limit','maybeSingle','update','upsert','delete','lte'])chain[method]=(...args:unknown[])=>{call.steps.push([method,args]);return chain;};
 chain.then=(resolve:(value:unknown)=>void)=>resolve({data:table.includes('preferences')?null:[],count:7,error:mocks.failure?{message:'failure'}:null});
 return chain;
}
const req=(body:unknown,origin='https://example.test')=>new NextRequest('https://example.test/api/chat/features/notifications',{method:'POST',headers:{host:'example.test',origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
describe('private notification API',()=>{
 beforeEach(()=>{mocks.calls.length=0;mocks.failure=false;mocks.access.mockResolvedValue({user:{id:owner},db:{from},role:'owner'});});
 it('denies nonmembers before reading private notifications',async()=>{mocks.access.mockResolvedValue(null);expect((await GET()).status).toBe(404);expect((await POST(req({action:'read',id:notification}))).status).toBe(404);expect(mocks.calls).toHaveLength(0);});
 it('scopes every inbox query to the session account',async()=>{const response=await GET();expect(response.status).toBe(200);expect((await response.json()).unread).toBe(7);expect(mocks.calls).toHaveLength(4);for(const c of mocks.calls)expect(c.steps).toContainEqual(['eq',['account_id',owner]]);});
 it('cannot mark another account notification read through a forged account id',async()=>{await POST(req({action:'read',id:notification,account_id:'attacker'}));expect(mocks.calls[0].steps).toContainEqual(['eq',['account_id',owner]]);expect(mocks.calls[0].steps).toContainEqual(['eq',['id',notification]]);});
 it('keeps new arrivals unread when marking the loaded inbox read',async()=>{const before='2026-09-16T18:00:00.000Z';await POST(req({action:'read_all',before}));expect(mocks.calls[0].steps).toContainEqual(['lte',['created_at',before]]);expect(mocks.calls[0].steps).toContainEqual(['eq',['account_id',owner]]);});
 it('validates preferences and prevents extra account fields',async()=>{expect((await POST(req({action:'preferences',preferences:{...defaultNotificationPreferences,account_id:'attacker'}}))).status).toBe(400);expect(mocks.calls).toHaveLength(0);await POST(req({action:'preferences',preferences:{...defaultNotificationPreferences,replies:false},account_id:'attacker'}));expect(mocks.calls[0].steps).toContainEqual(['upsert',[{...defaultNotificationPreferences,replies:false,account_id:owner}]]);});
 it('scopes mute and unmute to the current account',async()=>{await POST(req({action:'mute',requestId:notification,muted:true}));expect(mocks.calls[0].steps).toContainEqual(['upsert',[{account_id:owner,request_id:notification},{onConflict:'account_id,request_id'}]]);await POST(req({action:'mute',requestId:notification,muted:false}));expect(mocks.calls[1].steps).toContainEqual(['eq',['account_id',owner]]);});
 it('rejects cross-origin changes and invalid bodies',async()=>{expect((await POST(req({action:'read',id:notification},'https://other.test'))).status).toBe(403);for(const b of [null,[],{}, {action:'read',id:'bad'}, {action:'read_all',before:'bad'}, {action:'mute',requestId:notification,muted:'yes'}])expect((await POST(req(b))).status).toBe(400);expect(mocks.calls).toHaveLength(0);});
 it('does not pretend a failed read or save succeeded',async()=>{mocks.failure=true;expect((await GET()).status).toBe(503);expect((await POST(req({action:'read',id:notification}))).status).toBe(503);});
});
