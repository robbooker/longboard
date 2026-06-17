import { afterEach, describe, expect, it } from "vitest";
import { runDailyAnalyticsReport } from "@/lib/analytics/dailyReport";

const ENV_KEYS = [
  "GA4_PROPERTY_ID",
  "GOOGLE_ANALYTICS_PROPERTY_ID",
  "GA4_CLIENT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GA4_PRIVATE_KEY",
  "GOOGLE_PRIVATE_KEY",
  "GA4_SERVICE_ACCOUNT_JSON",
  "BUDDYCLAW_ROB_LIZ_WEBHOOK_URL",
  "LONGBOARD_SLACK_WEBHOOK_URL",
];

function clearAnalyticsEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("daily analytics report", () => {
  afterEach(() => {
    clearAnalyticsEnv();
  });

  it("skips cleanly when GA or Slack configuration is missing", async () => {
    clearAnalyticsEnv();

    await expect(runDailyAnalyticsReport()).resolves.toEqual({
      ok: false,
      missing: [
        "GA4_PROPERTY_ID",
        "GA4_CLIENT_EMAIL or GA4_SERVICE_ACCOUNT_JSON",
        "GA4_PRIVATE_KEY or GA4_SERVICE_ACCOUNT_JSON",
        "BUDDYCLAW_ROB_LIZ_WEBHOOK_URL or LONGBOARD_SLACK_WEBHOOK_URL",
      ],
    });
  });
});
