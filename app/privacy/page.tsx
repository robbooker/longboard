import type { Metadata } from "next";
import LegalDocumentPage from "@/components/legal/LegalDocumentPage";

export const metadata: Metadata = {
  title: "Privacy Policy - Longboard AI",
  description: "Longboard AI privacy policy.",
};

const sections = [
  {
    title: "Overview",
    paragraphs: [
      "Longboard AI provides trading research, market education, watchlists, alerts, member tools, and related services. This Privacy Policy explains what information we collect, how we use it, and the choices you have.",
      "We do not sell, rent, or resell your personal information. We do not use cookies to serve third-party advertising or behavioral ads.",
    ],
  },
  {
    title: "Information we collect",
    bullets: [
      "Account information, such as your name, email address, login details, preferences, and membership status.",
      "Information you provide to us, such as support requests, profile details, survey responses, messages, or other content you submit.",
      "Usage and device information, such as pages viewed, features used, browser type, device type, IP address, approximate location, referring URLs, logs, and timestamps.",
      "Payment and subscription information when applicable. Payment processors may handle card or billing details. Longboard AI does not intentionally store full payment card numbers.",
      "Mobile app information when you use a Longboard AI app, such as app version, device type, crash diagnostics, and operating-system information made available through the app platform.",
    ],
  },
  {
    title: "How we use information",
    bullets: [
      "To provide, operate, maintain, and improve Longboard AI.",
      "To authenticate users, secure accounts, prevent abuse, and troubleshoot technical issues.",
      "To personalize your own experience, including remembering preferences, showing relevant member content, and improving product flow.",
      "To send service messages, account notices, support replies, product updates, and other communications you request or expect from us.",
      "To understand aggregate usage, performance, and reliability so we can make the service better.",
      "To comply with legal obligations and enforce our terms.",
    ],
  },
  {
    title: "Cookies and personalization",
    paragraphs: [
      "We use cookies, local storage, and similar technologies for ordinary product functions like signing you in, keeping the service secure, remembering preferences, and personalizing your own experience.",
      "We do not use cookies to serve ads. We do not use cookies to track you across unrelated websites for advertising. If we use analytics cookies or similar tools, they are used to understand Longboard AI performance and product usage, not to build advertising profiles.",
    ],
  },
  {
    title: "How we share information",
    paragraphs: [
      "We share information only as needed to run Longboard AI, comply with law, protect rights and safety, or complete a business transaction such as a merger or acquisition.",
    ],
    bullets: [
      "Service providers may help us with hosting, authentication, analytics, email delivery, payments, customer support, security, and similar operational needs.",
      "Legal, safety, and compliance disclosures may occur if required by law or if we believe disclosure is necessary to protect Longboard AI, our users, or others.",
      "We may share aggregated or de-identified information that does not reasonably identify you.",
    ],
  },
  {
    title: "Your choices",
    bullets: [
      "You may update or correct account information through the service when those controls are available.",
      "You may disable some cookies in your browser, but the service may not work properly without cookies needed for login, security, or preferences.",
      "You may unsubscribe from non-essential email communications using the link or instructions in those messages.",
      "You may request access, correction, or deletion of personal information by contacting us.",
    ],
  },
  {
    title: "Data retention and security",
    paragraphs: [
      "We keep personal information for as long as reasonably necessary to provide the service, maintain business records, resolve disputes, enforce agreements, and comply with legal obligations.",
      "We use reasonable administrative, technical, and organizational safeguards designed to protect personal information. No system is perfectly secure, and we cannot guarantee absolute security.",
    ],
  },
  {
    title: "Children",
    paragraphs: [
      "Longboard AI is not directed to children under 13, and we do not knowingly collect personal information from children under 13.",
    ],
  },
  {
    title: "Changes",
    paragraphs: [
      "We may update this Privacy Policy from time to time. If we make material changes, we will update the effective date and may provide additional notice where appropriate.",
    ],
  },
  {
    title: "Contact",
    paragraphs: [
      "Questions, privacy requests, and account deletion requests can be sent to contact@longboardai.com.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocumentPage
      title="Privacy Policy"
      eyebrow="Longboard AI"
      description="We use personal information to run Longboard AI, keep accounts secure, and personalize each user's own experience. We do not resell personal information, and we do not use cookies for advertising."
      updated="July 6, 2026"
      sections={sections}
    />
  );
}
