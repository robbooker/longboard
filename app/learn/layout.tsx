import Command2NavLive from "@/components/command2/Command2NavLive";
import { getCommand2CurrentUser } from "@/lib/command2/currentUser";

/** Renders the /command2 dark top nav above every /learn surface — the
 *  Daily index and essay detail pages alike. Sits outside the .daily-page
 *  and .essay-page scoped wrappers so the editorial font/line-height
 *  variables can't reach into the nav. User+cohort fetch mirrors
 *  /command2's page.tsx so the avatar menu lights up identically. */
export default async function LearnLayout({ children }: { children: React.ReactNode }) {
  const currentUser = await getCommand2CurrentUser();

  return (
    <>
      <Command2NavLive activeTab="learn" currentUser={currentUser} />
      {children}
    </>
  );
}
