// #376 Gainers Table: Interactive Brokers' borrow fee and shares available, from IB's free public
// short stock file. IB publishes it for anyone by anonymous FTP:
//   host ftp2.interactivebrokers.com, user "shortstock", empty password, file usa.txt
//   (about 1.8 MB, about 20,000 rows, rewritten roughly every 15 minutes), and usa.txt.md5 beside it
//   (32 hex characters: the MD5 of the file with LF line ends, though it downloads with CRLF),
//   which is what we check first so an unchanged file is never downloaded twice.
// The file (checked 2026-11-08), CRLF lines, pipe-separated, every data line ending in "|":
//   #BOF|2026.11.08|13:33:42                          <- when IB wrote it (New York time)
//   #SYM|CUR|NAME|CON|ISIN|REBATERATE|FEERATE|AVAILABLE|FIGI|
//   AAPL|USD|APPLE INC|265598|XXXXXXX31005|3.4502|0.4298|>10000000|BBG000B9XRY4|
//   2777456Q|USD|HYDROMAID INTERNATIONAL INC|244127238|XXXXXXXF1093|NA|NA|2000||
//   #EOF|20030                                        <- the number of data lines
// REBATERATE and FEERATE are % a year ("NA" when IB has none); AVAILABLE is shares IB can lend,
// ">10000000" when it has more than ten million. A stock that isn't in the file has none to lend.
// Downloading uses the system's curl (FTP isn't in Node's fetch), with timeouts; nothing else is
// installed. Node 22+.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";

export const IB_HOST = "ftp2.interactivebrokers.com";
export const IB_FILE = "usa.txt";
const IB_USER = "shortstock:"; // anonymous: IB's public user, empty password
const CONNECT_TIMEOUT_S = 15;
const MD5_TIMEOUT_S = 30;
const FILE_TIMEOUT_S = 120;
const MAX_BYTES = 16 * 1024 * 1024;
const TICKER = /^[A-Z][A-Z. ]{0,11}$/;
/** The columns we read, by their header names (so a reordered file still reads right). */
const NEEDED = ["SYM", "CUR", "REBATERATE", "FEERATE", "AVAILABLE"];

/** The UTC instant of a New York wall-clock time (handles daylight saving). */
export function easternToIso(year, month, day, hour, minute, second) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetAt = (at) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      })
        .formatToParts(new Date(at))
        .map((part) => [part.type, part.value]),
    );
    const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return wall - at;
  };
  // Twice: the offset at the first guess can be an hour off right at a clock change.
  let at = guess - offsetAt(guess);
  at = guess - offsetAt(at);
  return new Date(at).toISOString();
}

const rate = (text) => {
  const value = String(text ?? "").trim();
  if (!value || value.toUpperCase() === "NA") return null;
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= 100_000 ? parsed : undefined;
};

const shares = (text) => {
  const value = String(text ?? "").trim();
  if (!value || value.toUpperCase() === "NA") return { available: null, availableMore: false };
  const match = /^(>)?\s*(\d{1,13})$/.exec(value);
  if (!match) return undefined;
  return { available: Number(match[2]), availableMore: !!match[1] };
};

/**
 * Reads IB's usa.txt. Returns { fileTime (ISO), rows: Map ticker -> { feePct, rebatePct, available,
 * availableMore }, lines, skipped }. Throws when the file is cut short or isn't IB's format, so a
 * half-downloaded file is never posted. Odd data lines are skipped and counted. A ticker listed
 * more than once keeps its USD line.
 */
export function parseIbFile(text) {
  const lines = String(text).split(/\r?\n/);
  const bof = /^#BOF\|(\d{4})\.(\d{2})\.(\d{2})\|(\d{2}):(\d{2}):(\d{2})\s*$/.exec(lines[0] ?? "");
  if (!bof) throw new Error("not IB's short stock file (no #BOF line)");
  const [, y, mo, d, h, mi, s] = bof.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) throw new Error("bad #BOF time");
  const fileTime = easternToIso(y, mo, d, h, mi, s);
  const headerAt = lines.findIndex((line) => line.startsWith("#SYM|"));
  if (headerAt < 0) throw new Error("no #SYM header line");
  const names = lines[headerAt].slice(1).split("|").map((name) => name.trim().toUpperCase());
  const at = Object.fromEntries(NEEDED.map((name) => [name, names.indexOf(name)]));
  const missing = NEEDED.filter((name) => at[name] < 0);
  if (missing.length) throw new Error(`header has no ${missing.join(", ")}`);
  const widest = Math.max(...NEEDED.map((name) => at[name]));
  const eofLine = lines.findIndex((line) => line.startsWith("#EOF"));
  if (eofLine < 0) throw new Error("the file is cut short (no #EOF line)");
  const declared = /^#EOF\|(\d+)/.exec(lines[eofLine])?.[1];

  const rows = new Map();
  const currency = new Map();
  let data = 0,
    skipped = 0;
  for (let i = headerAt + 1; i < eofLine; i++) {
    const line = lines[i];
    if (!line || line.startsWith("#")) continue;
    data++;
    const cells = line.split("|");
    if (cells.length <= widest) {
      skipped++;
      continue;
    }
    const ticker = (cells[at.SYM] ?? "").trim().toUpperCase();
    const fee = rate(cells[at.FEERATE]);
    const rebate = rate(cells[at.REBATERATE]);
    const avail = shares(cells[at.AVAILABLE]);
    if (!TICKER.test(ticker) || fee === undefined || rebate === undefined || avail === undefined) {
      skipped++;
      continue;
    }
    const cur = (cells[at.CUR] ?? "").trim().toUpperCase();
    if (rows.has(ticker) && currency.get(ticker) === "USD" && cur !== "USD") continue;
    rows.set(ticker, { feePct: fee, rebatePct: rebate, ...avail });
    currency.set(ticker, cur);
  }
  if (declared !== undefined && Number(declared) !== data)
    throw new Error(`the file is cut short (#EOF says ${declared} lines, read ${data})`);
  return { fileTime, rows, lines: data, skipped };
}

/** The rows to send for these tickers; a ticker not in IB's file has none to lend. */
export function ibRowsFor(parsed, tickers) {
  const unique = [...new Set((Array.isArray(tickers) ? tickers : []).filter((t) => typeof t === "string" && TICKER.test(t)))];
  return unique.map((ticker) => {
    const row = parsed.rows.get(ticker);
    return row
      ? { ticker, feePct: row.feePct, rebatePct: row.rebatePct, available: row.available, availableMore: row.availableMore }
      : { ticker, feePct: null, rebatePct: null, available: 0, availableMore: false };
  });
}

/** The posts for these rows, at most `size` rows each. */
export function ibPosts(fileTime, rows, size = 100) {
  const posts = [];
  for (let i = 0; i < rows.length; i += size) posts.push({ kind: "ib", fileTime, rows: rows.slice(i, i + size) });
  return posts;
}

/** The rows not sent yet for this file (sent: Map ticker -> fileTime). */
export function ibUnsent(rows, fileTime, sent) {
  return rows.filter((row) => sent.get(row.ticker) !== fileTime);
}

export const md5 = (buffer) => createHash("md5").update(buffer).digest("hex");

/**
 * One file from IB's FTP server, as a Buffer. `run` (execFile's shape) is passed in by tests.
 * @param {string} name
 * @param {{ timeout?: number, run?: (cmd: string, args: string[], opts: object, done: (error: Error | null, stdout: Buffer, stderr: string | Buffer) => void) => unknown }} [options]
 * @returns {Promise<Buffer>}
 */
export function ftpGet(name, { timeout = FILE_TIMEOUT_S, run = /** @type {any} */ (execFile) } = {}) {
  if (!/^[a-z]+\.txt(?:\.md5)?$/.test(name)) throw new Error("bad IB file name");
  return new Promise((resolve, reject) => {
    run(
      "curl",
      [
        "--silent",
        "--show-error",
        "--fail",
        "--ftp-pasv",
        "--connect-timeout",
        String(CONNECT_TIMEOUT_S),
        "--max-time",
        String(timeout),
        "--max-filesize",
        String(MAX_BYTES),
        "--user",
        IB_USER,
        `ftp://${IB_HOST}/${name}`,
      ],
      { encoding: "buffer", maxBuffer: MAX_BYTES, timeout: (timeout + 10) * 1000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const why = String(stderr ?? "").trim().split("\n").pop() || error.message;
          reject(new Error(`IB download of ${name} failed: ${why}`));
        } else resolve(Buffer.from(stdout));
      },
    );
  });
}

/**
 * The reader: remembers the last file it read. check() asks for usa.txt.md5 and downloads usa.txt
 * only when that changed (or nothing is held yet), checks the download against the MD5, and parses
 * it. Returns { parsed, changed }.
 */
export function createIbReader({ get = ftpGet } = {}) {
  let held = null;
  let heldMd5 = "";
  return {
    get parsed() {
      return held;
    },
    async check() {
      const sum = (await get(`${IB_FILE}.md5`, { timeout: MD5_TIMEOUT_S })).toString("latin1").trim().toLowerCase().slice(0, 32);
      if (!/^[0-9a-f]{32}$/.test(sum)) throw new Error("IB's usa.txt.md5 isn't an MD5");
      if (held && sum === heldMd5) return { parsed: held, changed: false };
      const file = await get(IB_FILE);
      // IB's MD5 is of the file with LF line ends (checked 2026-11-08); the download has CRLF. Either matches.
      const matches = md5(file) === sum || md5(Buffer.from(file.toString("latin1").replace(/\r\n/g, "\n"), "latin1")) === sum;
      // The file can be rewritten between the two downloads; then the next check tries again.
      if (!matches) throw new Error("IB's usa.txt didn't match its MD5 (probably mid-update); trying again later");
      held = parseIbFile(file.toString("latin1"));
      heldMd5 = sum;
      return { parsed: held, changed: true };
    },
  };
}
