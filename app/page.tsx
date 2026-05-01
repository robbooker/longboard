import type { Metadata } from "next";
import BubblesHome from "@/components/home/BubblesHome";

// Page-level metadata override for `/` only. Layout-level title +
// description in app/layout.tsx remain the site-wide fallback for
// every other route. OG image is intentionally not set here — the
// site root has no opengraph-image asset and adding one is out of
// scope for Phase 3N.
export const metadata: Metadata = {
  title: "Longboard — One email. The #1 stock of the day.",
  description: "One email. The #1 stock of the day, plus four more worth watching. 8:15am Eastern. Free.",
};

export default function Page() {
  return <BubblesHome />;
}
