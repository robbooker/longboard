import type { Metadata } from "next";
import BoardroomChat from "@/components/command2/BoardroomChat";
import { getCommand2CurrentUser } from "@/lib/command2/currentUser";
import styles from "./BoardroomChatPopout.module.css";

export const metadata: Metadata = {
  title: "Boardroom Chat · Longboard",
  description: "A compact realtime chat window for Longboard Boardroom members.",
};

export const dynamic = "force-dynamic";

export default async function BoardroomChatPage() {
  const currentUser = await getCommand2CurrentUser();

  return (
    <main className={styles.shell}>
      <BoardroomChat user={currentUser} variant="popout" />
    </main>
  );
}
