import { afterEach, describe, expect, it, vi } from "vitest";

import { answerPedro } from "@/lib/pedro/commands";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Pedro AI providers", () => {
  it("uses Anthropic before OpenAI when both providers are configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "Anthropic is answering." }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await answerPedro({ message: "Hello Pedro" });

    expect(result).toEqual({ intent: "general", text: "Anthropic is answering." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/messages");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).model).toBe("claude-sonnet-4-6");
  });

  it("falls back to OpenAI when Anthropic fails", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("overloaded", { status: 529 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "OpenAI fallback is answering." } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await answerPedro({ message: "Hello Pedro" });

    expect(result).toEqual({ intent: "general", text: "OpenAI fallback is answering." });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.anthropic.com/v1/messages",
      "https://api.openai.com/v1/chat/completions",
    ]);
  });
});
