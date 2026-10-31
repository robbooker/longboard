// #341: what the Runner Risk Watch feed accepts. The sender's guide is docs/runner-watch-sender-guide.md.
// Everything stays plain text; the page and the chat show it as text, never as HTML.
import { createHash } from "node:crypto";

export const RUNNER_WATCH_MAX_BYTES = 256_000;
export const RUNNER_WATCH_MAX_SUMMARY = 1000;
export const RUNNER_WATCH_MAX_TEXT = 50_000;
const MAX_KEY = 200;
const MAX_TICKERS = 20;

export type RunnerWatchUpdate = {
  key: string;
  hash: string;
  tickers: string[];
  summary: string;
  fullText: string;
  alert: boolean;
  sentAt: string | null;
};
export type RunnerWatchParse = { ok: true; update: RunnerWatchUpdate } | { ok: false; error: string };

// Control characters and the invisible ones that can reverse or hide text. Line breaks and tabs stay.
const UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​‎‏‪-‮⁦-⁩﻿]/g;
const clean = (value: string) => value.replace(/\r\n?/g, "\n").replace(UNSAFE, "").trim();
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** The same key always gives the same page address, so a resend can't make a second one. */
export function runnerWatchReportId(key: string): string {
  const hex = sha256(`runner-watch:${key}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function parseRunnerWatchUpdate(value: unknown): RunnerWatchParse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "invalid_update" };
  const p = value as Record<string, unknown>;
  if (typeof p.summary !== "string") return { ok: false, error: "summary_required" };
  if (typeof p.fullText !== "string") return { ok: false, error: "full_text_required" };
  const summary = clean(p.summary),
    fullText = clean(p.fullText);
  if (!summary) return { ok: false, error: "summary_required" };
  if (!fullText) return { ok: false, error: "full_text_required" };
  if (summary.length > RUNNER_WATCH_MAX_SUMMARY) return { ok: false, error: "summary_too_long" };
  if (fullText.length > RUNNER_WATCH_MAX_TEXT) return { ok: false, error: "full_text_too_long" };

  const tickers: string[] = [];
  if (p.tickers !== undefined && p.tickers !== null) {
    if (!Array.isArray(p.tickers) || p.tickers.length > MAX_TICKERS) return { ok: false, error: "invalid_tickers" };
    for (const raw of p.tickers) {
      if (typeof raw !== "string") return { ok: false, error: "invalid_tickers" };
      const ticker = raw.trim().replace(/^\$/, "").toUpperCase();
      if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) return { ok: false, error: "invalid_tickers" };
      if (!tickers.includes(ticker)) tickers.push(ticker);
    }
  }
  if (p.alert !== undefined && p.alert !== null && typeof p.alert !== "boolean") return { ok: false, error: "invalid_alert" };

  let sentAt: string | null = null;
  if (p.sentAt !== undefined && p.sentAt !== null) {
    if (typeof p.sentAt !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(p.sentAt) || !Number.isFinite(Date.parse(p.sentAt)))
      return { ok: false, error: "invalid_sent_at" };
    sentAt = new Date(p.sentAt).toISOString();
  }

  const hash = sha256(JSON.stringify([tickers, summary, fullText]));
  const given = p.id ?? p.dedupeKey;
  if (given !== undefined && given !== null && (typeof given !== "string" || !clean(given) || clean(given).length > MAX_KEY - 3))
    return { ok: false, error: "invalid_id" };
  // No id: the words themselves are the key, so an identical resend is still one update.
  const key = typeof given === "string" ? `id:${clean(given)}` : `hash:${hash.slice(0, 64)}`;
  return { ok: true, update: { key, hash, tickers, summary, fullText, alert: p.alert === true, sentAt } };
}
