import type { Metadata } from "next";
import ThisWeekInLongingClient from "./ThisWeekInLongingClient";

export const metadata: Metadata = {
  title: "This Week in Longing | Longboard",
  description: "Date-range performance review of Longboard 5-minute RVOL signals.",
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ThisWeekInLongingPage({ searchParams }: PageProps) {
  const params = await searchParams;
  return <ThisWeekInLongingClient initialStart={first(params.start)} initialEnd={first(params.end)} />;
}
