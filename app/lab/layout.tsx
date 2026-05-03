import LabHeader from "@/components/LabHeader";

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LabHeader />
      {children}
    </>
  );
}
