import { afterEach, describe, expect, it, vi } from "vitest";
import { runNanoChat } from "@/lib/chatOpenAI";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Longboard Chat Nano client", () => {
  it("uses the inexpensive model without storing the response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "Hello from Buddy" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runNanoChat({ instructions: "Be brief", input: "Hello" })).resolves.toBe("Hello from Buddy");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload).toMatchObject({ model: "gpt-4.1-nano", store: false });
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-key" });
  });
});
