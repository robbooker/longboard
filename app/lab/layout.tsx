import Command2Header from "@/components/command2/Command2Header";
import { getCommand2CurrentUser } from "@/lib/command2/currentUser";

export default async function LabLayout({ children }: { children: React.ReactNode }) {
  const currentUser = await getCommand2CurrentUser();

  return (
    <>
      <Command2Header currentUser={currentUser} />
      {children}
    </>
  );
}
