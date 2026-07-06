import type { Metadata } from "next";
import LegalDocumentPage from "@/components/legal/LegalDocumentPage";

export const metadata: Metadata = {
  title: "Terms of Use - Longboard AI",
  description: "Longboard AI terms of use.",
};

const sections = [
  {
    title: "Acceptance",
    paragraphs: [
      "These Terms of Use are an agreement between you and Longboard AI. By accessing or using Longboard AI, you agree to these terms. If you do not agree, do not use the service.",
      "We may update these terms from time to time. The effective date above shows when this version became effective.",
    ],
  },
  {
    title: "The service",
    paragraphs: [
      "Longboard AI provides market research tools, trading education, watchlists, alerts, member content, data visualizations, and related services. Features may change over time, and some features may require an account, subscription, invitation, or separate eligibility.",
    ],
  },
  {
    title: "Accounts",
    bullets: [
      "You are responsible for keeping your account credentials secure.",
      "You may not share, sell, rent, or transfer your account without our permission.",
      "You must provide accurate information when creating or maintaining an account.",
      "You are responsible for activity that occurs through your account.",
    ],
  },
  {
    title: "No financial advice",
    paragraphs: [
      "Longboard AI is provided for research, education, and informational purposes only. Nothing in the service is personalized financial, investment, tax, legal, or accounting advice.",
      "Trading and investing involve risk, including the risk of losing money. You are responsible for your own decisions, orders, risk controls, and results. Past performance, model output, scanner results, alerts, commentary, and examples do not guarantee future results.",
    ],
  },
  {
    title: "Acceptable use",
    paragraphs: [
      "You agree to use Longboard AI lawfully and respectfully. You may not misuse the service or interfere with other users, systems, data, or security.",
    ],
    bullets: [
      "Do not scrape, spider, crawl, harvest, index, copy, or bulk download Longboard AI content, data, pages, APIs, or outputs without written permission.",
      "Do not use bots, robots, automated scripts, data mining tools, browser automation, credential stuffing, or other robotic access except where we expressly allow it.",
      "Do not bypass rate limits, access controls, authentication, paywalls, robots instructions, or security measures.",
      "Do not reverse engineer, decompile, probe, scan, or test the vulnerability of the service except as authorized in writing.",
      "Do not resell, redistribute, syndicate, frame, mirror, or commercially exploit Longboard AI content or data without written permission.",
      "Do not upload malware, abusive content, unlawful content, spam, or anything that infringes another person's rights.",
      "Do not use the service to make decisions for other people without their informed consent and any required professional authorization.",
    ],
  },
  {
    title: "Content and intellectual property",
    paragraphs: [
      "Longboard AI, including its software, design, text, research, trade names, logos, graphics, videos, audio, reports, data displays, and other materials, is owned by Longboard AI or its licensors and is protected by intellectual property laws.",
      "We grant you a limited, revocable, non-exclusive, non-transferable license to use the service for your personal or internal business use, subject to these terms. We reserve all rights not expressly granted.",
    ],
  },
  {
    title: "User content",
    paragraphs: [
      "If you submit content, feedback, messages, notes, profile information, or other material to Longboard AI, you represent that you have the rights needed to do so.",
      "You give Longboard AI permission to use, host, store, reproduce, modify, and display that content as needed to provide, secure, support, and improve the service.",
    ],
  },
  {
    title: "Subscriptions and payments",
    paragraphs: [
      "Some features may be paid. Prices, trial terms, renewal terms, taxes, cancellation rules, and refund rules may be shown at checkout or in the service. Unless stated otherwise, fees are non-refundable to the fullest extent permitted by law.",
    ],
  },
  {
    title: "Third-party services",
    paragraphs: [
      "Longboard AI may link to or integrate with third-party services, data providers, brokers, payment processors, app stores, analytics tools, or other products. We are not responsible for third-party services, and their terms and privacy policies may apply.",
    ],
  },
  {
    title: "Availability and termination",
    paragraphs: [
      "We may modify, suspend, or discontinue all or part of the service at any time. We may suspend or terminate access if we believe you violated these terms, created risk, failed to pay fees, or used the service in a way that could harm Longboard AI or others.",
    ],
  },
  {
    title: "Disclaimers",
    paragraphs: [
      "The service is provided on an as-is and as-available basis. To the fullest extent permitted by law, Longboard AI disclaims warranties of any kind, whether express, implied, or statutory, including warranties of merchantability, fitness for a particular purpose, title, accuracy, and non-infringement.",
      "We do not guarantee that the service will be uninterrupted, error-free, secure, accurate, complete, or suitable for your particular trading or investing goals.",
    ],
  },
  {
    title: "Limitation of liability",
    paragraphs: [
      "To the fullest extent permitted by law, Longboard AI will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, lost revenue, lost data, trading losses, investment losses, or business interruption.",
      "To the fullest extent permitted by law, Longboard AI's total liability for any claim related to the service will not exceed the amount you paid to Longboard AI for the service in the three months before the claim arose, or $100 if you did not pay Longboard AI during that period.",
    ],
  },
  {
    title: "Indemnity",
    paragraphs: [
      "You agree to defend, indemnify, and hold harmless Longboard AI from claims, damages, losses, liabilities, costs, and expenses arising from your use of the service, your content, your trading or investing decisions, or your violation of these terms.",
    ],
  },
  {
    title: "Governing law",
    paragraphs: [
      "These terms are governed by the laws of the State of Texas, without regard to conflict-of-law rules, except where applicable law requires otherwise.",
    ],
  },
  {
    title: "Contact",
    paragraphs: [
      "Questions about these Terms of Use can be sent to contact@longboardai.com.",
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalDocumentPage
      title="Terms of Use"
      eyebrow="Longboard AI"
      description="These terms cover access to Longboard AI, acceptable use, account responsibilities, research disclaimers, and the rules against scraping, robotic access, resale, and misuse."
      updated="July 6, 2026"
      sections={sections}
    />
  );
}
