import type { Metadata } from "next";
import { notFound } from "next/navigation";
import WorkbookClient from "@/components/workbooks/WorkbookClient";
import { getWorkbook } from "@/lib/workbooks/definitions";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const workbook = getWorkbook((await params).slug);
  return { title: workbook ? `${workbook.title} · Longboard Workbook` : "Workbook not found", robots: { index: false, follow: false } };
}

export default async function WorkbookPage({ params }: Props) {
  const workbook = getWorkbook((await params).slug);
  if (!workbook) notFound();
  return <WorkbookClient workbook={workbook} />;
}
