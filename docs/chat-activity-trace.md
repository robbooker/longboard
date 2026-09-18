# Feature-card activity trace

`CodexActivityTrace` is a decorative working indicator below the existing feature-card status. It uses the existing `in_progress` status, not live worker telemetry. The original status text remains the accessible source of truth; the SVG is hidden from assistive technology.

The trace uses CSS animations, a small SVG, and ticket-seeded timing and branch variation. There is no animation JavaScript loop, extra polling, new dependency, schema change, or backend change. An IntersectionObserver and document visibility listener pause animation offscreen or in background tabs. Reduced-motion preferences show a static trace.

When a mounted card changes from working to ready or done, a brief checkmark appears for 1.8 seconds, then the trace disappears. Initially completed cards do not replay a completion animation. This indicates completion of development when the status becomes ready, not publication; the visible status continues to say Ready for review.

## Verification

Run the existing unit suite, TypeScript, targeted lint, and production build. Browser assertions in `scripts/tests/chat-activity-trace-browser.mjs` cover real FeatureChannel card layout at 1440/390/320 pixels, working-only rendering, seeded variation, reduced motion, completion settling, and offscreen pause.

For an isolated browser fixture, temporarily create `app/trace-test/page.tsx` that imports and renders `FeatureChannel` without auth. Start the local dev server on port 3275 with dummy local Supabase configuration, then run the browser script. It intercepts chat API responses with synthetic data. Remove the temporary page before production build or commit. Alternatively set TRACE_URL to an equivalent local harness. Never add this fixture route to production.

Release plan: migration-free. The login HTTP probe checks deployment availability; authenticated feature-card acceptance is covered separately by the local browser checks.
