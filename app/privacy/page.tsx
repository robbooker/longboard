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
      "Longboard AI provides trading research, market education, watchlists, RVOL alerts, push notifications, member tools, and related services. This Privacy Policy explains what information we collect, how we use it, and the choices you have.",
      "We do not sell, rent, or resell your personal information. We do not use cookies to serve third-party advertising or behavioral ads.",
    ],
  },
  {
    title: "Information we collect",
    bullets: [
      "Account information. When you create an account, we collect your email address and a securely hashed password. Authentication is handled by Supabase, our authentication and database provider.",
      "Device push tokens. If you enable push notifications, we collect and store a device push token, which is an anonymous identifier issued by Expo and Apple that lets us deliver notifications to your device.",
      "Device details for notification management, such as your device platform, for example iOS, and device name, so you can manage your registered devices.",
      "We do not receive your phone number or any content from your device.",
      "Information you provide to us, such as support requests, privacy requests, account deletion requests, profile details, messages, or other content you submit.",
      "Basic usage, log, and diagnostic information, such as pages viewed, features used, browser type, app version, device type, IP address, approximate location, referring URLs, logs, crash diagnostics, and timestamps.",
    ],
  },
  {
    title: "How we use information",
    bullets: [
      "To create and maintain your account and keep you signed in.",
      "To authenticate users, secure accounts, prevent abuse, and troubleshoot technical issues.",
      "To send you push notifications for RVOL alerts and related app updates, but only after you opt in.",
      "To personalize your own experience, including remembering preferences, showing relevant member content, and improving product flow.",
      "To send service messages, account notices, support replies, product updates, and other communications you request or expect from us.",
      "To understand aggregate usage, performance, and reliability so we can make Longboard AI better.",
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
    title: "How we share information (service providers)",
    paragraphs: [
      "We do not sell your personal information. We share limited data with service providers solely to operate Longboard AI, comply with law, protect rights and safety, or complete a business transaction such as a merger or acquisition.",
    ],
    bullets: [
      "Supabase stores your account information and your device push tokens. Supabase's privacy policy is available at https://supabase.com/privacy.",
      "Expo receives your device push token and notification content in order to deliver push notifications to your device. Expo's privacy policy is available at https://expo.dev/privacy.",
      "Legal, safety, and compliance disclosures may occur if required by law or if we believe disclosure is necessary to protect Longboard AI, our users, or others.",
      "We may share aggregated or de-identified information that does not reasonably identify you.",
    ],
  },
  {
    title: "Your choices",
    bullets: [
      "You may update or correct account information through the service when those controls are available.",
      "You may disable some cookies in your browser, but the service may not work properly without cookies needed for login, security, or preferences.",
      "You can disable push notifications at any time in your device settings or by deleting your account.",
      "You may unsubscribe from non-essential email communications using the link or instructions in those messages.",
      "You may request access, correction, or deletion of personal information by contacting us.",
    ],
  },
  {
    title: "Data retention and deletion",
    paragraphs: [
      "We retain your account information and device push tokens for as long as your account is active or as otherwise reasonably necessary to provide the service, maintain business records, resolve disputes, enforce agreements, and comply with legal obligations.",
      "You can permanently delete your account and all associated data at any time from within the app by going to Settings > Delete Account. When you delete your account, your account record and all registered device push tokens are permanently removed.",
      "You may also contact us at contact@longboardai.com to request deletion.",
    ],
  },
  {
    title: "Security",
    paragraphs: [
      "We use reasonable administrative, technical, and organizational safeguards designed to protect personal information, including relying on Supabase for authentication and secure password handling. No system is perfectly secure, and we cannot guarantee absolute security.",
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
