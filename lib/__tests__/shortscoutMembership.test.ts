import {describe,it,expect,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import {verifyShortScoutMembership} from "@/lib/shortscoutMembership";
function fixture(level:string|null="mastermind",confirmed=true) {
 const getUser=vi.fn().mockResolvedValue({data:{user:{id:"verified-subject",email_confirmed_at:confirmed?"2026-01-01":null,user_metadata:{user_level:"mastermind"}}},error:null});
 const profile=vi.fn().mockResolvedValue({data:level===null?null:{user_id:"verified-subject",user_level:level},error:null});
 const eq=vi.fn().mockReturnValue({maybeSingle:profile});
 const from=vi.fn().mockReturnValue({select:()=>({eq})});
 return {client:{auth:{getUser},from} as unknown as SupabaseClient,getUser,profile,eq,from};
}
describe("ShortScout membership verification foundation",()=>{
 it("verifies the session and looks up only its subject",async()=>{const f=fixture();expect(await verifyShortScoutMembership("user-token",f.client)).toEqual({ok:true,subject:"verified-subject",level:"mastermind"});expect(f.getUser).toHaveBeenCalledWith("user-token");expect(f.eq).toHaveBeenCalledWith("user_id","verified-subject");});
 it.each(["free","unknown",null])("denies %s even when editable metadata claims mastermind",async level=>{const f=fixture(level);expect(await verifyShortScoutMembership("token",f.client)).toEqual({ok:false,reason:"not_paid"});});
 it("rejects an unconfirmed identity before looking up membership",async()=>{const f=fixture("mastermind",false);expect((await verifyShortScoutMembership("token",f.client)).ok).toBe(false);expect(f.from).not.toHaveBeenCalled();});
 it("rejects an invalid token before looking up membership",async()=>{const f=fixture();f.getUser.mockResolvedValue({data:{user:null},error:{message:"invalid"}});expect(await verifyShortScoutMembership("token",f.client)).toEqual({ok:false,reason:"invalid_session"});expect(f.from).not.toHaveBeenCalled();});
 it("fails closed on database errors without exposing diagnostics",async()=>{const f=fixture();f.profile.mockResolvedValue({data:null,error:{message:"secret diagnostic"}});expect(await verifyShortScoutMembership("token",f.client)).toEqual({ok:false,reason:"unavailable"});});
 it("rejects empty tokens without contacting Supabase",async()=>{const f=fixture();expect((await verifyShortScoutMembership("",f.client)).ok).toBe(false);expect(f.getUser).not.toHaveBeenCalled();});
});
