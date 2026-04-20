# Covered Caller

**Status:** planned — not live, not funded, not scheduled.
**Needs:** index-options chain access (SPY / QQQ daily expiries); options enabled on a paper account.

## Mandate

Index shares + daily-expiry covered calls.

## Why it's parked

Covered-call overlay on a long-index-shares base. The writable part — picking strike + expiry + roll rules — is well-specified in the literature but needs a concrete parameter set (delta target, days-to-expiry, roll triggers) before it's worth wiring. That's a standalone design pass, not a variation on Long/Short.

Full spec lands after Phase 2 (Long/Short Portfolio) has been running cleanly.
