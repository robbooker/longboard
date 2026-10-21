import ChatApiTokens from "./ChatApiTokens";
import styles from "./ChatDevelopers.module.css";

// CHAT-API: the developers page: personal API tokens and a quick start. The full reference is /chat-api.md.
export default function ChatDevelopers() {
  return (
    <main className={styles.page}>
      <div className={styles.wrap}>
        <p className={styles.back}>
          <a href="/chat">← Back to chat</a>
        </p>
        <h1>Chat for developers</h1>
        <p className={styles.lede}>
          Use chat from your own code: read rooms, post, reply, react and follow along live. A token acts as
          you, with exactly the rooms and permissions you have in chat.
        </p>

        <section className={styles.section} aria-labelledby="tokens">
          <h2 id="tokens">Your API tokens</h2>
          <ChatApiTokens />
        </section>

        <section className={styles.section} aria-labelledby="start">
          <h2 id="start">Quick start</h2>
          <p>Send the token in an Authorization header. Read the latest messages in Social:</p>
          <pre className={styles.code}>
            <code>{`export LBC_TOKEN=lbc_…
curl -H "Authorization: Bearer $LBC_TOKEN" \\
  "https://chat.robbooker.com/api/chat/history?room=social"`}</code>
          </pre>
          <p>Post a message:</p>
          <pre className={styles.code}>
            <code>{`curl -X POST -H "Authorization: Bearer $LBC_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"room":"social","action":"send","body":"Hello from my terminal"}' \\
  https://chat.robbooker.com/api/chat`}</code>
          </pre>
          <p>
            Every endpoint, with requests and responses: <a href="/chat-api.md">the chat API reference</a>.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="rules">
          <h2 id="rules">Good to know</h2>
          <ul className={styles.notes}>
            <li>Anything you post with a token appears under your chat name, like a message you typed.</li>
            <li>Keep tokens secret. If one leaks, revoke it above; it stops working straight away.</li>
            <li>
              Tokens can&apos;t reach chat&apos;s admin panel, summaries, the Make clearer helper, sign-in,
              phone notification settings or this page.
            </li>
            <li>
              Chat&apos;s normal limits apply, such as one room message every 1.5 seconds. Poll politely, or
              use live updates.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
