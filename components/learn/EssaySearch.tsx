"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type SearchResult = {
  slug: string;
  issue: number;
  title: string;
  kicker: string | null;
  dek: string | null;
  published: string | null;
  read_minutes: number | null;
  audio_url: string | null;
  daily_rank: number | null;
  publish_at: string | null;
  rank: number;
  snippet: string;
};

const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

/** Wraps the Daily layout. When the search query is empty (< MIN_QUERY
 *  chars after trim), renders children as-is — the Daily hero, features
 *  grid, rail, floor, and pull-band pass through unchanged. When the
 *  query is long enough, the Daily layout is hidden and ranked results
 *  render in its place. Clearing the query restores the Daily layout.
 *
 *  Keyboard: `/` focuses the search input from anywhere on the page
 *  (unless the user is already in a text field). `Escape` clears the
 *  query and blurs the input. */
export default function EssaySearch({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const activeQuery = query.trim();
  const searching = activeQuery.length >= MIN_QUERY;

  useEffect(() => {
    if (!searching) {
      setResults(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/essays/search?q=${encodeURIComponent(activeQuery)}`,
          { cache: "no-store", signal: abort.signal },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setResults((data.results ?? []) as SearchResult[]);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [activeQuery, searching]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setQuery("");
      e.currentTarget.blur();
    }
  }, []);

  return (
    <>
      <div className="search-shelf">
        <div className="search-shelf-inner">
          <div className="search-field">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search essays…"
              aria-label="Search essays"
              autoComplete="off"
              spellCheck={false}
            />
            <span className="search-hint">
              {searching ? "Esc to clear" : "press / to focus"}
            </span>
          </div>
        </div>
      </div>

      {searching ? (
        <div className="wrap search-results">
          {loading && (!results || results.length === 0) && (
            <p className="search-note">Searching…</p>
          )}
          {error && <p className="search-note search-error">{error}</p>}
          {!loading && results && results.length === 0 && !error && (
            <p className="search-note">
              No results for &ldquo;{activeQuery}&rdquo;. Press{" "}
              <kbd>Esc</kbd> to clear.
            </p>
          )}
          {results && results.length > 0 && (
            <>
              <p className="search-meta">
                {results.length} result{results.length === 1 ? "" : "s"}
                {" "}for &ldquo;{activeQuery}&rdquo;
              </p>
              <ol className="search-list">
                {results.map((r) => (
                  <li key={r.slug} className="search-card">
                    <p className="search-card-meta">
                      Issue {pad3(r.issue)}
                      {r.read_minutes ? ` · ${r.read_minutes} min` : ""}
                    </p>
                    <h3 className="search-card-title">
                      <Link href={`/learn/${r.slug}`}>{r.title}</Link>
                    </h3>
                    {r.dek && <p className="search-card-dek">{r.dek}</p>}
                    <p
                      className="search-card-snippet"
                      dangerouslySetInnerHTML={{ __html: r.snippet }}
                    />
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      ) : (
        children
      )}
    </>
  );
}
