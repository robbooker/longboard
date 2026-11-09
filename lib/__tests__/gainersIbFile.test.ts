import { describe, expect, it, vi } from "vitest";
import {
  createIbReader,
  easternToIso,
  ftpGet,
  ibPosts,
  ibRowsFor,
  ibUnsent,
  md5,
  parseIbFile,
} from "../../scripts/gainers-lookup/ib.mjs";
import { ibRound } from "../../scripts/gainers-lookup/lookup.mjs";

// #376: Interactive Brokers' public short stock file (usa.txt), from small synthetic lines in the
// real file's shape (checked against a real download on 2026-11-08). No FTP request is sent.
const HEADER = "#SYM|CUR|NAME|CON|ISIN|REBATERATE|FEERATE|AVAILABLE|FIGI|";
const file = (rows: string[], { bof = "#BOF|2026.11.09|09:42:10", eof = `#EOF|${rows.length}` } = {}) =>
  [bof, HEADER, ...rows, eof, ""].join("\r\n");
const ROWS = [
  "AAPL|USD|APPLE INC|265598|XXXXXXX31005|3.4502|0.4298|>10000000|BBG000B9XRY4|",
  "HOTT|USD|HOT STOCK INC|111|XXXXXXX00001|-1386.4635|1390.3435|70000|BBG000000001|",
  "MIDL|USD|MIDDLE CORP|112|XXXXXXX00002|-5.02|8.88|2800000||",
  "NAAA|USD|NO RATE INC|113|XXXXXXX00003|NA|NA|2000||",
  "ZERO|USD|NONE LEFT INC|114|XXXXXXX00004|3.63|0.25|0|BBG000000004|",
  "ABR PRD|USD|ARBOR REALTY TRUST INC|494398845|XXXXXXX38769|-18.4188|22.2988|200000|BBG0116Z9JS1|",
  "DUPE|EUR|DUPE AG|115|XXXXXXX00005|1.0|2.0|500||",
  "DUPE|USD|DUPE INC|116|XXXXXXX00006|3.0|4.0|600||",
  "DUPE|EUR|DUPE AG 2|117|XXXXXXX00007|1.0|2.0|700||",
  "049323AB4|USD|A BOND|557991763|XXXXXXX3AB46|3.6300|0.2500|2800000||",
  "BADR|USD|BAD RATE|118|X|abc|1.0|100||",
  "BADA|USD|BAD AVAIL|119|X|1.0|1.0|lots||",
  "SHORT|USD",
];

describe("parseIbFile (#376)", () => {
  const parsed = parseIbFile(file(ROWS));
  it("reads the file's time as New York time", () => {
    expect(parsed.fileTime).toBe("2026-11-09T14:42:10.000Z");
    expect(easternToIso(2026, 7, 1, 9, 30, 0)).toBe("2026-07-01T13:30:00.000Z");
    expect(easternToIso(2026, 11, 1, 1, 30, 0)).toMatch(/^2026-11-01T0[56]:30:00\.000Z$/);
    expect(easternToIso(2026, 3, 8, 12, 0, 0)).toBe("2026-03-08T16:00:00.000Z");
  });
  it("reads rates, NA and shares with >", () => {
    expect(parsed.rows.get("AAPL")).toEqual({ feePct: 0.4298, rebatePct: 3.4502, available: 10_000_000, availableMore: true });
    expect(parsed.rows.get("HOTT")).toEqual({ feePct: 1390.3435, rebatePct: -1386.4635, available: 70_000, availableMore: false });
    expect(parsed.rows.get("NAAA")).toEqual({ feePct: null, rebatePct: null, available: 2000, availableMore: false });
    expect(parsed.rows.get("ZERO")).toMatchObject({ available: 0, availableMore: false });
    expect(parsed.rows.get("ABR PRD")).toMatchObject({ feePct: 22.2988 });
  });
  it("keeps the USD line of a ticker listed twice", () => {
    expect(parsed.rows.get("DUPE")).toMatchObject({ feePct: 4, available: 600 });
  });
  it("skips odd lines and counts them", () => {
    expect(parsed.lines).toBe(ROWS.length);
    expect(parsed.rows.has("049323AB4")).toBe(false);
    expect(parsed.rows.has("BADR")).toBe(false);
    expect(parsed.rows.has("BADA")).toBe(false);
    expect(parsed.rows.has("SHORT")).toBe(false);
    expect(parsed.skipped).toBe(4);
  });
  it("reads LF-only files and a reordered header", () => {
    const text = ["#BOF|2026.11.09|09:42:10", "#SYM|FEERATE|AVAILABLE|CUR|REBATERATE|", "XYZ|5.5|>10000000|USD|-1.5|", "#EOF|1"].join("\n");
    expect(parseIbFile(text).rows.get("XYZ")).toEqual({ feePct: 5.5, rebatePct: -1.5, available: 10_000_000, availableMore: true });
  });
  it("refuses a file that's cut short or isn't IB's", () => {
    expect(() => parseIbFile(file(ROWS, { eof: "" }))).toThrow(/cut short/);
    expect(() => parseIbFile(file(ROWS, { eof: "#EOF|999" }))).toThrow(/cut short/);
    expect(() => parseIbFile(file(ROWS, { bof: "hello" }))).toThrow(/BOF/);
    expect(() => parseIbFile(file(ROWS, { bof: "#BOF|2026.13.09|09:42:10" }))).toThrow(/time/);
    expect(() => parseIbFile("#BOF|2026.11.09|09:42:10\r\n#SYM|CUR|NAME|\r\n#EOF|0")).toThrow(/header/);
    expect(() => parseIbFile("<html>error</html>")).toThrow();
  });
});

describe("the rows sent to the chat (#376)", () => {
  const parsed = parseIbFile(file(ROWS));
  it("sends today's tickers, missing ones as 0 available", () => {
    expect(ibRowsFor(parsed, ["HOTT", "GONE", "HOTT", "bad", 5])).toEqual([
      { ticker: "HOTT", feePct: 1390.3435, rebatePct: -1386.4635, available: 70_000, availableMore: false },
      { ticker: "GONE", feePct: null, rebatePct: null, available: 0, availableMore: false },
    ]);
  });
  it("splits into posts of at most 100 rows and skips rows already sent for that file", () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ ticker: `T${String.fromCharCode(65 + (i % 26))}${i}` }));
    expect(ibPosts("t", rows).map((p: { rows: unknown[] }) => p.rows.length)).toEqual([100, 100, 50]);
    expect(ibPosts("t", rows)[0]).toMatchObject({ kind: "ib", fileTime: "t" });
    const sent = new Map([["A", "t1"], ["B", "t0"]]);
    expect(ibUnsent([{ ticker: "A" }, { ticker: "B" }, { ticker: "C" }], "t1", sent).map((r: { ticker: string }) => r.ticker)).toEqual(["B", "C"]);
  });
});

describe("the reader and the loop (#376)", () => {
  const text = file(ROWS);
  const fakeGet = (files: Record<string, string>) =>
    vi.fn(async (name: string) => {
      if (!(name in files)) throw new Error(`no ${name}`);
      return Buffer.from(files[name], "latin1");
    });
  it("downloads usa.txt only when its MD5 changed, and checks the download against it", async () => {
    const files = { "usa.txt": text, "usa.txt.md5": md5(Buffer.from(text, "latin1")) };
    const get = fakeGet(files);
    const reader = createIbReader({ get });
    expect((await reader.check()).changed).toBe(true);
    expect((await reader.check()).changed).toBe(false);
    expect(get.mock.calls.map((c) => c[0])).toEqual(["usa.txt.md5", "usa.txt", "usa.txt.md5"]);
    const other = file(ROWS.slice(0, 2), { bof: "#BOF|2026.11.09|09:57:10" });
    files["usa.txt"] = other;
    files["usa.txt.md5"] = "0".repeat(32);
    await expect(reader.check()).rejects.toThrow(/MD5/);
    expect(reader.parsed.fileTime).toBe("2026-11-09T14:42:10.000Z");
    files["usa.txt.md5"] = md5(Buffer.from(other, "latin1"));
    expect((await reader.check()).parsed.fileTime).toBe("2026-11-09T14:57:10.000Z");
    // IB's real .md5 is of the file with LF line ends; the download has CRLF.
    const third = file(ROWS.slice(0, 3), { bof: "#BOF|2026.11.09|10:12:10" });
    files["usa.txt"] = third;
    files["usa.txt.md5"] = `${md5(Buffer.from(third.replace(/\r\n/g, "\n"), "latin1"))}\n`;
    expect((await reader.check()).parsed.rows.size).toBe(3);
    files["usa.txt.md5"] = "<html>";
    await expect(reader.check()).rejects.toThrow(/isn't an MD5/);
  });
  it("posts each ticker once per file, and nothing without tickers", async () => {
    const files = { "usa.txt": text, "usa.txt.md5": md5(Buffer.from(text, "latin1")) };
    const get = fakeGet(files);
    const reader = createIbReader({ get });
    const post = vi.fn(async () => ({}));
    const sent = new Map();
    let tickers: string[] = [];
    const round = () => ibRound({ reader, sent, post, getTickers: async () => tickers, log: () => {} });
    expect(await round()).toBe(0);
    expect(get).not.toHaveBeenCalled();
    tickers = ["HOTT", "AAPL"];
    expect(await round()).toBe(2);
    expect(await round()).toBe(0);
    tickers = ["NEWT", "HOTT", "AAPL"];
    expect(await round()).toBe(1);
    expect(post).toHaveBeenLastCalledWith({
      kind: "ib",
      fileTime: "2026-11-09T14:42:10.000Z",
      rows: [{ ticker: "NEWT", feePct: null, rebatePct: null, available: 0, availableMore: false }],
    });
    // A failed post is sent again next round.
    post.mockRejectedValueOnce(new Error("chat answered 503"));
    tickers = ["LATE"];
    await expect(round()).rejects.toThrow(/503/);
    expect(await round()).toBe(1);
  });
  it("downloads with curl, anonymous FTP, passive, with timeouts", async () => {
    const run = vi.fn((cmd: string, args: string[], opts: unknown, done: (e: Error | null, out: Buffer, err: string) => void) => {
      void opts;
      done(null, Buffer.from("abc"), "");
    });
    expect(String(await ftpGet("usa.txt.md5", { timeout: 30, run }))).toBe("abc");
    const [cmd, args] = run.mock.calls[0];
    expect(cmd).toBe("curl");
    expect(args).toEqual(expect.arrayContaining(["--fail", "--ftp-pasv", "--max-time", "30", "--connect-timeout", "--user", "shortstock:"]));
    expect(args[args.length - 1]).toBe("ftp://ftp2.interactivebrokers.com/usa.txt.md5");
    expect(() => ftpGet("../etc/passwd", { run })).toThrow(/bad IB file/);
    const failing = vi.fn((c: string, a: string[], o: unknown, done: (e: Error | null, out: Buffer, err: string) => void) =>
      done(new Error("exit 28"), Buffer.alloc(0), "curl: (28) Connection timed out\n"),
    );
    await expect(ftpGet("usa.txt", { run: failing })).rejects.toThrow(/usa.txt failed: curl: \(28\) Connection timed out/);
  });
});
