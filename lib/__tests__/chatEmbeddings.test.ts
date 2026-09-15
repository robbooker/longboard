import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({admin:vi.fn()}));
vi.mock("@/lib/chatAdmin",()=>({createChatAdminClient:mocks.admin}));
import {embedChatText,indexChatBatch} from "@/lib/chatEmbeddings";
const vector=Array(1536).fill(0.1);
beforeEach(()=>{vi.stubEnv("OPENAI_API_KEY","test-only");vi.stubGlobal("fetch",vi.fn());});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("chat embeddings",()=>{
 it("restores API order and uses the fixed model and dimension",async()=>{
  vi.mocked(fetch).mockResolvedValue(Response.json({data:[{index:1,embedding:vector},{index:0,embedding:vector}],usage:{total_tokens:12}}));
  expect((await embedChatText(["one","two"])).tokens).toBe(12);
  const call=vi.mocked(fetch).mock.calls[0];
  expect(JSON.parse(call[1]?.body as string)).toMatchObject({model:"text-embedding-3-small",dimensions:1536,input:["one","two"]});
 });
 it("rejects malformed provider responses and hides provider diagnostics",async()=>{
  vi.mocked(fetch).mockResolvedValue(Response.json({data:[{index:0,embedding:[1]}]}));
  await expect(embedChatText(["one"])).rejects.toThrow("invalid_embedding_response");
  vi.mocked(fetch).mockResolvedValue(new Response("private provider diagnostic",{status:429}));
  await expect(embedChatText(["one"])).rejects.toThrow("embedding_provider_429");
 });
 it("does not call the provider for an empty index queue",async()=>{
  mocks.admin.mockReturnValue({rpc:vi.fn().mockResolvedValue({data:[],error:null})});
  expect(await indexChatBatch()).toEqual({indexed:0,tokens:0});expect(fetch).not.toHaveBeenCalled();
 });
 it("never overwrites an edited message using an old lease",async()=>{
  const select=vi.fn().mockResolvedValue({data:[],error:null});
  const eq=vi.fn();eq.mockReturnValue({eq,select});
  mocks.admin.mockReturnValue({rpc:vi.fn().mockResolvedValue({data:[{message_id:"id",content_hash:"hash",lease_id:"lease",content:"text"}],error:null}),from:()=>({update:()=>({eq})})});
  vi.mocked(fetch).mockResolvedValue(Response.json({data:[{index:0,embedding:vector}],usage:{total_tokens:2}}));
  expect((await indexChatBatch()).indexed).toBe(0);
  expect(eq.mock.calls).toEqual([["message_id","id"],["content_hash","hash"],["lease_id","lease"]]);
 });
});
