import { afterEach, describe, expect, it, vi } from "vitest";

import { answerPedro } from "@/lib/pedro/commands";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function wetoReference() {
  return {
    results: {
      ticker: "WETO",
      name: "Wetouch Technology Inc.",
      primary_exchange: "XNAS",
      sic_description: "Electronic Components",
      description: "Wetouch Technology develops and manufactures medium-to-large projected capacitive touchscreens for industrial customers.",
    },
  };
}

function secTickerList() {
  return {
    0: { cik_str: 123456, ticker: "WETO", title: "Wetouch Technology Inc." },
  };
}

function marketBars() {
  return Array.from({ length: 60 }, (_, index) => ({
    t: Date.UTC(2026, 4, index + 1),
    o: 1.9 + index * 0.01,
    h: 2.05 + index * 0.01,
    l: 1.8 + index * 0.01,
    c: 1.95 + index * 0.01,
    v: 500_000 + index * 5_000,
  }));
}

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

describe("Pedro ticker overview", () => {
  it.each(["Tell me more about WETO", "tell me more about weto", "$weto"])(
    "answers natural ticker request: %s",
    async (message) => {
      vi.stubEnv("POLYGON_API_KEY", "polygon-test-key");
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("OPENAI_API_KEY", "");
      vi.stubEnv("ASKEDGAR_API_KEY", "askedgar-test-key");
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/v3/reference/tickers/WETO")) return jsonResponse(wetoReference());
        if (url === "https://www.sec.gov/files/company_tickers.json") return jsonResponse(secTickerList());
        if (url.includes("/v2/aggs/ticker/WETO/")) return jsonResponse({ results: marketBars() });
        if (url.includes("/v3/snapshot")) {
          return jsonResponse({ results: [{ session: { price: 2.6, change_percent: 4.2, volume: 900_000 } }] });
        }
        if (url === "https://data.sec.gov/submissions/CIK0000123456.json") {
          return jsonResponse({
            filings: {
              recent: {
                form: ["8-K", "10-Q", "4"],
                filingDate: ["2026-08-12", "2026-08-01", "2026-07-30"],
                accessionNumber: ["0000123456-26-000003", "0000123456-26-000002", "0000123456-26-000001"],
                primaryDocument: ["weto-8k.htm", "weto-10q.htm", "weto-form4.htm"],
              },
            },
          });
        }
        if (url.includes("/v1/dilution-rating")) {
          return jsonResponse({ results: [{ overall_offering_risk: "High", dilution: "Medium", cash_need: "High", cash_remaining_months: 3.4 }] });
        }
        if (url.includes("/v1/registrations")) return jsonResponse({ results: [{ form_type: "S-3" }] });
        if (url.includes("/v1/nasdaq-compliance")) return jsonResponse({ results: [] });
        if (url.includes("/v1/float-outstanding")) return jsonResponse({ results: [{ float: 8_500_000, shares_outstanding: 14_200_000 }] });
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await answerPedro({ message });

      expect(result.intent).toBe("ticker-overview");
      expect(result.text).toContain("## WETO at a glance");
      expect(result.text).toContain("Wetouch Technology Inc.");
      expect(result.text).toContain("## Current tape");
      expect(result.text).toContain("Latest available price: $2.600 (+4.20%)");
      expect(result.text).toContain("Overall offering risk: High");
      expect(result.text).toContain("Reported float / shares outstanding: 8.50M / 14.20M");
      expect(result.text).toContain("8-K filed 2026-08-12");
      expect(result.text).toContain("`targets WETO`, `risk WETO`, or `filings WETO`");
      expect(result.text).not.toMatch(/no live market data|current knowledge base/i);
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("api.anthropic.com"))).toBe(false);
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("api.openai.com"))).toBe(false);
    },
  );

  it("returns a useful partial overview when market, SEC filing, and risk sources fail", async () => {
    vi.stubEnv("POLYGON_API_KEY", "polygon-test-key");
    vi.stubEnv("ASKEDGAR_API_KEY", "askedgar-test-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/v3/reference/tickers/WETO")) return jsonResponse(wetoReference());
      if (url === "https://www.sec.gov/files/company_tickers.json") return jsonResponse(secTickerList());
      return new Response("temporarily unavailable", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await answerPedro({ message: "What is WETO?" });

    expect(result.intent).toBe("ticker-overview");
    expect(result.text).toContain("Wetouch Technology Inc.");
    expect(result.text).toContain("Polygon market data was temporarily unavailable");
    expect(result.text).toContain("AskEdgar risk data was unavailable");
    expect(result.text).toContain("SEC filing metadata was unavailable");
  });

  it("gives a clear correction when a requested symbol cannot be verified", async () => {
    vi.stubEnv("POLYGON_API_KEY", "polygon-test-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/v3/reference/tickers/ZZZZZZZZ")) return jsonResponse({ results: null });
      if (url === "https://www.sec.gov/files/company_tickers.json") return jsonResponse(secTickerList());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await answerPedro({ message: "Tell me about ZZZZZZZZ" });

    expect(result).toEqual({
      intent: "ticker-overview",
      text: "I could not verify **ZZZZZZZZ** as a stock ticker in Polygon or the SEC company list. Check the symbol and try again, or use a dollar sign such as `$ZZZZZZZZ`.",
    });
  });
});
