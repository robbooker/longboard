import { parseChatRoom } from "@/lib/publicChat";
import Link from "next/link";
import { chatLoginFonts } from "@/components/login/chatLoginFonts";
import styles from "@/components/login/ChatLogin.module.css";

export default async function ChatLogin({ searchParams }: { searchParams: Promise<{ room?: string; popout?: string }> }) {
  const params = await searchParams;
  const room = parseChatRoom(params.room) ?? "main";
  const query = `room=${room}${params.popout === "1" ? "&popout=1" : ""}`;
  return (
    <div className={`${styles.page} ${chatLoginFonts}`}>
      <header className={styles.header}>
        <Link href="/" className={styles.wordmark}><span aria-hidden="true" className={styles.mark}>L</span> LONGBOARD<span className={styles.accent}>AI</span></Link>
        <span className={styles.headerNote}>THE COMMUNITY</span>
      </header>
      <main className={styles.main}>
        <section className={styles.intro} aria-labelledby="chat-login-title">
          <p className={styles.eyebrow}>GOOD COMPANY. BETTER CONVERSATIONS.</p>
          <h1 id="chat-login-title">YOUR PEOPLE.<br />YOUR MARKETS.<br /><span>YOUR CHAT.</span></h1>
          <p className={styles.description}>Talk markets, share ideas, and stay connected with your community.</p>
          <div className={styles.rooms} aria-label="Chat communities"><span>LB</span><span>SOCIAL</span><span>SS</span></div>
        </section>
        <section className={styles.choices} aria-labelledby="membership-title">
          <p className={styles.eyebrow}>MEMBER ACCESS</p>
          <h2 id="membership-title">Sign in to chat.</h2>
          <p className={styles.subheading}>Choose your membership to get started.</p>
          <Link className={styles.option} href={`/login?next=${encodeURIComponent(`/chat?${query}`)}`}>
            <span className={styles.optionTop}><strong>Longboard</strong><span aria-hidden="true">↗</span></span>
            <span className={styles.optionDetail}>Access to LB + SOCIAL</span>
            <span className={styles.optionAction}>Sign in with Longboard <span aria-hidden="true">→</span></span>
          </Link>
          <a className={`${styles.option} ${styles.secondary}`} href={`/api/chat/login/start?${query}`}>
            <span className={styles.optionTop}><strong>ShortScout</strong><span aria-hidden="true">↗</span></span>
            <span className={styles.optionDetail}>Mastermind · SS + SOCIAL; other paid tiers · SOCIAL</span>
            <span className={styles.optionAction}>Sign in with ShortScout <span aria-hidden="true">→</span></span>
          </a>
          <p className={styles.linkNote}><strong>Have both?</strong> Sign in with Longboard, then connect ShortScout from the chat menu.</p>
        </section>
      </main>
      <footer className={styles.footer}><span>LONGBOARD AI · A PLACE TO CONNECT</span><a href="mailto:contact@longboardai.com">Need a hand? ↗</a></footer>
    </div>
  );
}
