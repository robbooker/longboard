import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICKER_PATTERN = /^[A-Z][A-Z0-9.]{0,5}$/;
const DEFAULT_ASKEDGAR_BASE_URL = "https://eapi.askedgar.io";

type JsonObject = Record<string, unknown>;

type EndpointResult = {
  data: JsonObject | null;
  error: string | null;
};

function sanitizeTicker(input: string | null): string | null {
  if (!input) return null;
  const ticker = input.trim().toUpperCase();
  return TICKER_PATTERN.test(ticker) ? ticker : null;
}

function askedgarBaseUrl(): string {
  return (process.env.ASKEDGAR_API_BASE_URL ?? DEFAULT_ASKEDGAR_BASE_URL).replace(/\/+$/, "");
}

function stringValue(source: JsonObject | null, keys: string[]): string | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "boolean") return value ? "Yes" : "No";
  }
  return null;
}

function numberValue(source: JsonObject | null, keys: string[]): number | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/[$,%\s,]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function firstObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    return value.find((item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item)) ?? null;
  }

  const object = value as JsonObject;
  for (const key of ["data", "result", "results", "dilution_rating", "float_outstanding"]) {
    const nested = object[key];
    if (Array.isArray(nested)) {
      const found = nested.find((item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item));
      if (found) return found;
    }
    if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested as JsonObject;
  }
  return object;
}

function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const object = payload as JsonObject;

  if (typeof object.message === "string" && object.message.trim()) {
    return object.message.trim();
  }

  if (object.error && typeof object.error === "object" && !Array.isArray(object.error)) {
    const error = object.error as JsonObject;
    if (typeof error.message === "string" && error.message.trim()) {
      return error.message.trim();
    }
  }

  return fallback;
}

async function fetchAskEdgar(path: string, ticker: string, apiKey: string): Promise<EndpointResult> {
  const url = new URL(`${askedgarBaseUrl()}${path}`);
  url.searchParams.set("ticker", ticker);
  url.searchParams.set("limit", "1");

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "API-KEY": apiKey,
        Accept: "application/json",
      },
    });

    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) as unknown : null;
    } catch {
      return {
        data: null,
        error: `AskEdgar ${path} returned a non-JSON response.`,
      };
    }

    if (!response.ok) {
      return {
        data: null,
        error: `AskEdgar ${path} returned ${response.status}: ${errorMessage(payload, "Request failed.")}`,
      };
    }

    return { data: firstObject(payload), error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : `Unable to load AskEdgar ${path}.`,
    };
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ticker = sanitizeTicker(url.searchParams.get("ticker"));

  if (!ticker) {
    return NextResponse.json(
      { error: "Invalid ticker." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const apiKey = process.env.ASKEDGAR_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "ASKEDGAR_API_KEY is not set on the server." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const [dilutionRating, floatOutstanding] = await Promise.all([
    fetchAskEdgar("/v1/dilution-rating", ticker, apiKey),
    fetchAskEdgar("/v1/float-outstanding", ticker, apiKey),
  ]);

  const dilution = dilutionRating.data;
  const float = floatOutstanding.data;
  const errors = [dilutionRating.error, floatOutstanding.error].filter((error): error is string => !!error);

  return NextResponse.json(
    {
      ticker,
      fetchedAt: new Date().toISOString(),
      marketCap: numberValue(float, ["market_cap_final", "market_cap", "marketCap"]),
      estimatedCash: numberValue(dilution, ["estimated_cash", "est_cash_now", "cash_now", "cash", "cash_and_equivalents"]),
      cashRemainingMonths: numberValue(dilution, ["cash_remaining_months", "months_cash_remaining", "runway_months"]),
      dilutionRisk: stringValue(dilution, ["dilution", "dilution_risk", "dilution_risk_rating", "risk"]),
      dilutionRiskDesc: stringValue(dilution, ["dilution_desc", "dilution_risk_desc", "risk_desc"]),
      cashNeed: stringValue(dilution, ["cash_need", "cash_need_rating"]),
      cashNeedDesc: stringValue(dilution, ["cash_need_desc"]),
      overallOfferingRisk: stringValue(dilution, ["overall_offering_risk", "offering_risk", "overall_risk"]),
      offeringAbility: stringValue(dilution, ["offering_ability", "ability_to_raise", "shelf_available"]),
      offeringAbilityDesc: stringValue(dilution, ["offering_ability_desc", "ability_to_raise_desc", "shelf_available_desc"]),
      offeringFrequency: stringValue(dilution, ["offering_frequency", "frequency"]),
      offeringFrequencyDesc: stringValue(dilution, ["offering_frequency_desc", "frequency_desc"]),
      nasdaqCompliance: stringValue(dilution, ["nasdaq_compliance"]),
      nasdaqComplianceDesc: stringValue(dilution, ["nasdaq_compliance_desc"]),
      cashBurn: numberValue(dilution, ["cash_burn", "cash_burn_quarterly"]),
      regsho: typeof dilution?.regsho === "boolean" ? dilution.regsho : null,
      notes: stringValue(dilution, ["analysis", "summary", "notes", "dilution_overview"]),
      errors,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
