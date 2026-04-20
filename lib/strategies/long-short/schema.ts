// Decision-contract validator for Claude's morning-run output. Manual
// validator rather than zod (not in package.json and not worth the
// dep for one file). Returns either { ok: true, value } or
// { ok: false, errors } — callers use the errors array for the
// strat_runs.error column so it's grep-able in audit logs.

export type ForbiddenSide = "long";

export type SkipDecision = {
  decision: "skip";
  /** Prose reason. Required. Shows up on /strategies/long-short as the
   *  writeup when Claude declines to trade. */
  thesis: string;
  writeup_md: string;
};

export type EnterDecision = {
  decision: "enter";
  ticker: string;
  side: ForbiddenSide;
  size_pct: number;           // 3.0 .. 7.0
  stop_price: number;         // required; must be below entry for longs
  thesis: string;
  catalyst_source: string;    // URL or prose attribution
  expected_horizon_days: number;
  holds_through_earnings: boolean;
  holds_through_earnings_reason: string | null;
  writeup_md: string;
};

export type Decision = SkipDecision | EnterDecision;

export type ValidateResult =
  | { ok: true; value: Decision }
  | { ok: false; errors: string[] };

const SIZE_MIN = 3.0;
const SIZE_MAX = 7.0;

function asString(raw: unknown, field: string, errs: string[]): string | undefined {
  if (typeof raw === "string" && raw.trim().length > 0) return raw;
  errs.push(`${field}: expected non-empty string`);
  return undefined;
}

function asNumber(raw: unknown, field: string, errs: string[]): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  errs.push(`${field}: expected finite number`);
  return undefined;
}

function asBoolean(raw: unknown, field: string, errs: string[]): boolean | undefined {
  if (typeof raw === "boolean") return raw;
  errs.push(`${field}: expected boolean`);
  return undefined;
}

/** Validates the JSON shape Claude is contracted to produce. Checks
 *  Phase-1-specific invariants (side must be 'long', ticker not empty,
 *  size_pct in [3, 7], stop_price required on enter). The forbidden-
 *  ticker check + "stop < entry for longs" check happen in
 *  morning-run.ts after entry_price is known, not here. */
export function validateDecision(raw: unknown): ValidateResult {
  const errors: string[] = [];

  if (typeof raw !== "object" || raw === null) {
    return { ok: false, errors: ["decision: expected JSON object"] };
  }

  const obj = raw as Record<string, unknown>;
  const decision = obj.decision;

  if (decision !== "enter" && decision !== "skip") {
    return { ok: false, errors: ["decision: must be 'enter' or 'skip'"] };
  }

  const thesis = asString(obj.thesis, "thesis", errors);
  const writeup_md = asString(obj.writeup_md, "writeup_md", errors);

  if (decision === "skip") {
    if (errors.length > 0) return { ok: false, errors };
    return {
      ok: true,
      value: {
        decision: "skip",
        thesis: thesis as string,
        writeup_md: writeup_md as string,
      },
    };
  }

  // decision === "enter" — now validate all the enter-only fields.
  const ticker = asString(obj.ticker, "ticker", errors);
  const sideRaw = obj.side;
  if (sideRaw !== "long") {
    errors.push(`side: must be 'long' (shorts arrive in Phase 2)`);
  }
  const size_pct = asNumber(obj.size_pct, "size_pct", errors);
  if (typeof size_pct === "number" && (size_pct < SIZE_MIN || size_pct > SIZE_MAX)) {
    errors.push(`size_pct: must be in [${SIZE_MIN}, ${SIZE_MAX}]`);
  }
  const stop_price = asNumber(obj.stop_price, "stop_price", errors);
  if (typeof stop_price === "number" && stop_price <= 0) {
    errors.push(`stop_price: must be positive`);
  }
  const catalyst_source = asString(obj.catalyst_source, "catalyst_source", errors);
  const expected_horizon_days = asNumber(
    obj.expected_horizon_days,
    "expected_horizon_days",
    errors,
  );
  if (typeof expected_horizon_days === "number" && expected_horizon_days < 0) {
    errors.push(`expected_horizon_days: must be >= 0`);
  }
  const holds_through_earnings = asBoolean(
    obj.holds_through_earnings,
    "holds_through_earnings",
    errors,
  );

  // holds_through_earnings_reason is nullable; only type-check when truthy.
  let holds_through_earnings_reason: string | null = null;
  if (obj.holds_through_earnings_reason === null || obj.holds_through_earnings_reason === undefined) {
    holds_through_earnings_reason = null;
  } else if (typeof obj.holds_through_earnings_reason === "string") {
    holds_through_earnings_reason = obj.holds_through_earnings_reason;
  } else {
    errors.push("holds_through_earnings_reason: expected string or null");
  }

  // If holding through earnings, reason is required by the handoff's mandate.
  if (holds_through_earnings === true && !holds_through_earnings_reason) {
    errors.push("holds_through_earnings_reason: required when holds_through_earnings is true");
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      decision: "enter",
      ticker: (ticker as string).toUpperCase().trim(),
      side: "long",
      size_pct: size_pct as number,
      stop_price: stop_price as number,
      thesis: thesis as string,
      catalyst_source: catalyst_source as string,
      expected_horizon_days: expected_horizon_days as number,
      holds_through_earnings: holds_through_earnings as boolean,
      holds_through_earnings_reason,
      writeup_md: writeup_md as string,
    },
  };
}
