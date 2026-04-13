import OnboardingClient from "./OnboardingClient";

export const dynamic = "force-dynamic";

/** The Supabase invite / password-reset redirect delivers auth tokens in the
 *  URL hash fragment, which only the browser sees. So the server component
 *  stays thin — the client component handles token consumption via the
 *  browser Supabase client's auto-exchange behavior. */
export default function OnboardingPage() {
  return <OnboardingClient />;
}
