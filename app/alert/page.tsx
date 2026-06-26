import type { Metadata } from "next";
import Link from "next/link";
import AlertSignupForm from "./AlertSignupForm";

export const metadata: Metadata = {
  title: "Longboard Alert",
  description: "Get the Longboard AI stock alert by email. SMS, Telegram, and more are next.",
  alternates: {
    canonical: "/alert",
  },
};

const channels = ["SMS", "Email", "Telegram", "More"];

const alertRows = [
  ["Setup", "The one Longboard is watching now"],
  ["Why", "Catalyst, volume, and chart context"],
  ["Risk", "Entry zone, invalidation, and skip note"],
  ["Delivery", "Phone first, inbox ready"],
];

export default function AlertPage() {
  return (
    <main className="alert-page">
      <header className="alert-nav" aria-label="Longboard alert navigation">
        <Link className="alert-wordmark" href="/">
          Longboard<span>AI</span>
        </Link>
        <a className="alert-nav__cta" href="#signup">
          Join
        </a>
      </header>

      <section className="alert-hero" aria-labelledby="alert-title">
        <div className="alert-hero__copy">
          <p className="alert-kicker">Longboard alert</p>
          <div className="alert-figure" aria-hidden="true">1</div>
          <h1 id="alert-title">One stock alert. Sent where you actually look.</h1>
          <p className="alert-lede">
            Longboard filters the market into a single AI-ranked trade idea with the thesis,
            levels, and risk note attached. Start with email today; phone delivery comes next.
          </p>
          <div className="alert-channel-line" aria-label="Delivery channels">
            {channels.map((channel) => (
              <span key={channel}>{channel}</span>
            ))}
          </div>
        </div>

        <aside className="alert-signup-panel" id="signup" aria-label="Join the Longboard alert list">
          <div className="alert-panel__label">Delivered to your phone</div>
          <h2>Get on the alert list.</h2>
          <p>Email first. On the next page we will ask for SMS details.</p>
          <AlertSignupForm />
        </aside>
      </section>

      <section className="alert-explainer" aria-label="How the alert works">
        <div className="alert-explainer__intro">
          <p className="alert-kicker">What changes</p>
          <h2>No countdown. No open-bell theater.</h2>
          <p>
            The page is about the alert itself: what you get, where it lands, and why one
            focused setup beats a pile of maybes.
          </p>
        </div>

        <div className="alert-spec" aria-label="Alert contents">
          {alertRows.map(([label, value]) => (
            <div className="alert-spec__row" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="alert-flow" aria-label="Delivery workflow">
        <div className="alert-flow__stage">
          <span>01</span>
          <h3>Scan the market.</h3>
          <p>Price action, catalyst context, chart structure, and risk are checked before a setup is promoted.</p>
        </div>
        <div className="alert-flow__stage">
          <span>02</span>
          <h3>Cut the list down.</h3>
          <p>The goal is not a watchlist dump. Longboard is built around one ranked idea at a time.</p>
        </div>
        <div className="alert-flow__stage">
          <span>03</span>
          <h3>Send it to you.</h3>
          <p>Delivered to your phone. SMS. Email. Telegram. And more.</p>
        </div>
      </section>

      <footer className="alert-footer">
        <div>
          <p className="alert-kicker">Email now, SMS next</p>
          <h2>Get the next Longboard alert.</h2>
        </div>
        <AlertSignupForm compact source="alert_landing_footer" />
        <p className="alert-disclaimer">
          Longboard AI provides research and information, not personalized investment advice.
          Investing involves risk, including possible loss of principal.
        </p>
      </footer>
    </main>
  );
}
