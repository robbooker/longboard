"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type PedroMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  state?: "error";
};

type PedroApiResponse = {
  intent?: string;
  text?: string;
  error?: string;
};

const STARTER_COMMANDS = [
  "help",
  "scanner",
  "quote BZFD",
  "targets TDIC",
  "risk BZFD",
  "research TDIC",
];

const HIDDEN_PATHS = ["/login", "/login/forgot", "/thanks", "/invite", "/charts"];

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function compactHistory(messages: PedroMessage[]) {
  return messages
    .filter((message) => message.content.trim())
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^mailto:/i.test(trimmed)) return trimmed;
  return null;
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let index = 0;

  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }

    if (token.startsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${index}`}>
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={`${keyPrefix}-code-${index}`}>
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = link ? safeHref(link[2]) : null;
      nodes.push(
        href ? (
          <a key={`${keyPrefix}-link-${index}`} href={href} target="_blank" rel="noreferrer">
            {link?.[1]}
          </a>
        ) : (
          token
        ),
      );
    }

    lastIndex = start + token.length;
    index += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length ? nodes : [text];
}

function PedroFormattedMessage({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let listItems: ReactNode[][] = [];
  let numberedItems: ReactNode[][] = [];

  function flushList() {
    if (listItems.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`}>
          {listItems.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>,
      );
      listItems = [];
    }
    if (numberedItems.length) {
      blocks.push(
        <ol key={`ol-${blocks.length}`}>
          {numberedItems.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ol>,
      );
      numberedItems = [];
    }
  }

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushList();
      blocks.push(
        <div key={`h-${lineIndex}`} className="pedro-md-heading">
          {renderInlineMarkdown(heading[2], `h-${lineIndex}`)}
        </div>,
      );
      return;
    }

    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      numberedItems = [];
      listItems.push(renderInlineMarkdown(bullet[1], `li-${lineIndex}`));
      return;
    }

    const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (numbered) {
      listItems = [];
      numberedItems.push(renderInlineMarkdown(numbered[1], `oli-${lineIndex}`));
      return;
    }

    flushList();
    blocks.push(
      <p key={`p-${lineIndex}`}>
        {renderInlineMarkdown(trimmed, `p-${lineIndex}`)}
      </p>,
    );
  });

  flushList();

  return <div className="pedro-md">{blocks}</div>;
}

export default function PedroChat() {
  const pathname = usePathname();
  const [eligible, setEligible] = useState(false);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<PedroMessage[]>([
    {
      id: "intro",
      role: "assistant",
      content:
        "Hey, I am Pedro. Ask me for the Longboard scanner, quotes, SEC filings, targets, AskEdgar risk, research briefs, translations, or normal market questions.",
    },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hiddenByPath = useMemo(
    () => HIDDEN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`)),
    [pathname],
  );

  useEffect(() => {
    if (hiddenByPath) {
      setEligible(false);
      return;
    }

    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => {
        if (!cancelled) setEligible(response.ok);
      })
      .catch(() => {
        if (!cancelled) setEligible(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hiddenByPath]);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open, sending]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 160);
    return () => window.clearTimeout(id);
  }, [open]);

  async function sendMessage(rawText: string) {
    const text = rawText.trim();
    if (!text || sending) return;

    const userMessage: PedroMessage = { id: nextId("user"), role: "user", content: text };
    const history = compactHistory([...messages, userMessage]);

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setSending(true);

    try {
      const response = await fetch("/api/pedro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      const data = await response.json().catch(() => ({})) as PedroApiResponse;
      if (!response.ok) throw new Error(data.error || "pedro_failed");
      setMessages((current) => [
        ...current,
        {
          id: nextId("assistant"),
          role: "assistant",
          content: data.text || "I am here, but I came up empty on that one.",
        },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: nextId("assistant"),
          role: "assistant",
          state: "error",
          content: "I hit a snag while thinking through that. Try me again in a minute.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  }

  if (!eligible) return null;

  return (
    <div className={`pedro-chat${open ? " is-open" : ""}`}>
      <style>{`
        .pedro-chat{
          --pedro-ink:#15120B;
          --pedro-paper:#F6F2E9;
          --pedro-card:#FBF8F0;
          --pedro-card-2:#EFEADD;
          --pedro-line:rgba(21,18,11,0.16);
          --pedro-muted:rgba(21,18,11,0.58);
          --pedro-amber:#F5A524;
          --pedro-gold:#B8860B;
          --pedro-danger:#B83A2E;
          position:fixed;
          right:22px;
          bottom:22px;
          z-index:1200;
          color:var(--pedro-ink);
          font-family:Helvetica,Arial,sans-serif;
          -webkit-font-smoothing:antialiased;
        }
        .pedro-chat *{box-sizing:border-box}
        .pedro-chat .pedro-launch{
          width:62px;
          height:62px;
          border:1px solid rgba(21,18,11,0.24);
          background:var(--pedro-ink);
          color:var(--pedro-paper);
          cursor:pointer;
          display:grid;
          place-items:center;
          box-shadow:0 18px 44px rgba(0,0,0,0.24);
          transition:transform 180ms ease,box-shadow 180ms ease,border-color 180ms ease;
        }
        .pedro-chat .pedro-launch:hover{
          transform:translateY(-3px);
          border-color:var(--pedro-amber);
          box-shadow:0 22px 54px rgba(0,0,0,0.3);
        }
        .pedro-chat .pedro-launch:focus-visible,
        .pedro-chat .pedro-close:focus-visible,
        .pedro-chat .pedro-chip:focus-visible,
        .pedro-chat .pedro-send:focus-visible,
        .pedro-chat textarea:focus-visible{
          outline:3px solid rgba(245,165,36,0.35);
          outline-offset:2px;
        }
        .pedro-chat .pedro-mark{
          width:38px;
          height:38px;
          display:grid;
          place-items:center;
          background:var(--pedro-amber);
          color:var(--pedro-ink);
          font-weight:900;
          font-size:18px;
          letter-spacing:0;
        }
        .pedro-chat .pedro-panel{
          position:absolute;
          right:0;
          bottom:76px;
          width:min(430px,calc(100vw - 28px));
          height:min(650px,calc(100vh - 112px));
          display:grid;
          grid-template-rows:auto 1fr auto;
          background:var(--pedro-card);
          border:1px solid var(--pedro-line);
          box-shadow:0 26px 80px rgba(0,0,0,0.34);
          overflow:hidden;
          transform-origin:bottom right;
          opacity:0;
          pointer-events:none;
          transform:translateY(12px) scale(0.96);
          transition:opacity 180ms ease,transform 220ms cubic-bezier(.2,.8,.2,1);
        }
        .pedro-chat.is-open .pedro-panel{
          opacity:1;
          pointer-events:auto;
          transform:translateY(0) scale(1);
        }
        .pedro-chat .pedro-head{
          min-height:74px;
          display:flex;
          align-items:center;
          gap:12px;
          padding:14px 16px;
          background:var(--pedro-ink);
          color:var(--pedro-paper);
          border-bottom:1px solid #000;
        }
        .pedro-chat .pedro-title{min-width:0;flex:1}
        .pedro-chat .pedro-name{
          font-weight:850;
          letter-spacing:0;
          line-height:1.1;
        }
        .pedro-chat .pedro-status{
          margin-top:4px;
          font-family:'Courier New',Courier,monospace;
          font-size:10px;
          letter-spacing:0;
          color:rgba(244,241,232,0.58);
          text-transform:uppercase;
        }
        .pedro-chat .pedro-status::before{
          content:"";
          display:inline-block;
          width:7px;
          height:7px;
          margin-right:7px;
          border-radius:50%;
          background:var(--pedro-amber);
          box-shadow:0 0 0 0 rgba(245,165,36,0.55);
          animation:pedro-pulse 1.8s infinite;
        }
        @keyframes pedro-pulse{
          0%{box-shadow:0 0 0 0 rgba(245,165,36,0.55)}
          70%{box-shadow:0 0 0 8px rgba(245,165,36,0)}
          100%{box-shadow:0 0 0 0 rgba(245,165,36,0)}
        }
        .pedro-chat .pedro-close{
          border:1px solid rgba(244,241,232,0.2);
          width:34px;
          height:34px;
          background:transparent;
          color:var(--pedro-paper);
          cursor:pointer;
          font-size:20px;
          line-height:1;
          transition:background 140ms ease,border-color 140ms ease;
        }
        .pedro-chat .pedro-close:hover{
          background:rgba(244,241,232,0.08);
          border-color:var(--pedro-amber);
        }
        .pedro-chat .pedro-log{
          overflow:auto;
          padding:18px 16px 10px;
          background:
            linear-gradient(to bottom,rgba(245,165,36,0.07),transparent 130px),
            var(--pedro-card);
          scroll-behavior:smooth;
        }
        .pedro-chat .pedro-message{
          display:flex;
          margin:0 0 12px;
        }
        .pedro-chat .pedro-message.user{justify-content:flex-end}
        .pedro-chat .pedro-bubble{
          max-width:86%;
          border:1px solid var(--pedro-line);
          padding:11px 12px;
          background:#fffdf8;
          color:var(--pedro-ink);
          font-size:13px;
          line-height:1.48;
          white-space:pre-wrap;
          overflow-wrap:anywhere;
        }
        .pedro-chat .pedro-md{
          white-space:normal;
        }
        .pedro-chat .pedro-md p{
          margin:0 0 10px;
        }
        .pedro-chat .pedro-md p:last-child,
        .pedro-chat .pedro-md ul:last-child,
        .pedro-chat .pedro-md ol:last-child{
          margin-bottom:0;
        }
        .pedro-chat .pedro-md ul,
        .pedro-chat .pedro-md ol{
          margin:8px 0 12px;
          padding-left:20px;
        }
        .pedro-chat .pedro-md li{
          margin:5px 0;
          padding-left:2px;
        }
        .pedro-chat .pedro-md strong{
          font-weight:800;
        }
        .pedro-chat .pedro-md code{
          display:inline-block;
          padding:1px 5px;
          border:1px solid rgba(21,18,11,0.14);
          background:rgba(21,18,11,0.055);
          font-family:'Courier New',Courier,monospace;
          font-size:0.92em;
        }
        .pedro-chat .pedro-md a{
          color:#8A6200;
          text-decoration:underline;
          text-underline-offset:3px;
        }
        .pedro-chat .pedro-md-heading{
          margin:12px 0 7px;
          font-weight:850;
        }
        .pedro-chat .pedro-md-heading:first-child{
          margin-top:0;
        }
        .pedro-chat .pedro-message.user .pedro-bubble{
          background:var(--pedro-ink);
          color:var(--pedro-paper);
          border-color:var(--pedro-ink);
        }
        .pedro-chat .pedro-message.error .pedro-bubble{
          border-color:rgba(184,58,46,0.35);
          color:var(--pedro-danger);
          background:rgba(184,58,46,0.06);
        }
        .pedro-chat .pedro-thinking{
          display:inline-flex;
          align-items:center;
          gap:5px;
        }
        .pedro-chat .pedro-dot{
          width:6px;
          height:6px;
          border-radius:50%;
          background:var(--pedro-gold);
          animation:pedro-dot 900ms ease-in-out infinite;
        }
        .pedro-chat .pedro-dot:nth-child(2){animation-delay:120ms}
        .pedro-chat .pedro-dot:nth-child(3){animation-delay:240ms}
        @keyframes pedro-dot{
          0%,100%{opacity:.35;transform:translateY(0)}
          50%{opacity:1;transform:translateY(-3px)}
        }
        .pedro-chat .pedro-tools{
          display:flex;
          gap:7px;
          flex-wrap:wrap;
          padding:0 16px 12px;
          background:var(--pedro-card);
          border-top:1px solid rgba(21,18,11,0.08);
        }
        .pedro-chat .pedro-chip{
          border:1px solid rgba(21,18,11,0.18);
          background:var(--pedro-card-2);
          color:var(--pedro-ink);
          height:28px;
          padding:0 9px;
          cursor:pointer;
          font-family:'Courier New',Courier,monospace;
          font-size:10px;
          letter-spacing:0;
          text-transform:uppercase;
          transition:background 140ms ease,border-color 140ms ease,transform 140ms ease;
        }
        .pedro-chat .pedro-chip:hover{
          background:#fffdf8;
          border-color:var(--pedro-gold);
          transform:translateY(-1px);
        }
        .pedro-chat .pedro-form{
          display:grid;
          grid-template-columns:1fr auto;
          gap:10px;
          padding:12px 16px 16px;
          background:var(--pedro-card);
          border-top:1px solid var(--pedro-line);
        }
        .pedro-chat textarea{
          width:100%;
          min-height:44px;
          max-height:118px;
          resize:none;
          border:1px solid rgba(21,18,11,0.22);
          background:#fffdf8;
          color:var(--pedro-ink);
          padding:11px 12px;
          font:13px/1.35 Helvetica,Arial,sans-serif;
          outline:none;
        }
        .pedro-chat textarea::placeholder{color:rgba(21,18,11,0.42)}
        .pedro-chat .pedro-send{
          width:48px;
          height:44px;
          border:1px solid var(--pedro-ink);
          background:var(--pedro-ink);
          color:var(--pedro-paper);
          cursor:pointer;
          font-family:'Courier New',Courier,monospace;
          font-weight:700;
          font-size:12px;
          transition:transform 140ms ease,background 140ms ease,opacity 140ms ease;
        }
        .pedro-chat .pedro-send:hover{transform:translateY(-1px);background:#000}
        .pedro-chat .pedro-send:disabled{
          opacity:.45;
          cursor:not-allowed;
          transform:none;
        }
        @media (max-width:640px){
          .pedro-chat{right:14px;bottom:14px}
          .pedro-chat .pedro-panel{
            right:-2px;
            bottom:72px;
            width:calc(100vw - 24px);
            height:min(620px,calc(100vh - 100px));
          }
          .pedro-chat .pedro-launch{width:58px;height:58px}
          .pedro-chat .pedro-bubble{max-width:92%}
        }
      `}</style>

      <div className="pedro-panel" role="dialog" aria-label="Pedro chat" aria-hidden={!open}>
        <div className="pedro-head">
          <div className="pedro-mark" aria-hidden="true">P</div>
          <div className="pedro-title">
            <div className="pedro-name">Pedro</div>
            <div className="pedro-status">Member research bot</div>
          </div>
          <button className="pedro-close" type="button" onClick={() => setOpen(false)} aria-label="Close Pedro chat">
            x
          </button>
        </div>

        <div className="pedro-log" ref={scrollRef} aria-live="polite">
          {messages.map((message) => (
            <div key={message.id} className={`pedro-message ${message.role}${message.state ? ` ${message.state}` : ""}`}>
              <div className="pedro-bubble">
                {message.role === "assistant" ? (
                  <PedroFormattedMessage content={message.content} />
                ) : (
                  message.content
                )}
              </div>
            </div>
          ))}
          {sending && (
            <div className="pedro-message assistant">
              <div className="pedro-bubble">
                <span className="pedro-thinking" aria-label="Pedro is thinking">
                  <span className="pedro-dot" />
                  <span className="pedro-dot" />
                  <span className="pedro-dot" />
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="pedro-tools" aria-label="Pedro quick commands">
          {STARTER_COMMANDS.map((command) => (
            <button
              key={command}
              className="pedro-chip"
              type="button"
              onClick={() => {
                setOpen(true);
                void sendMessage(command);
              }}
              disabled={sending}
            >
              {command}
            </button>
          ))}
        </div>

        <form className="pedro-form" onSubmit={handleSubmit}>
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            placeholder="Ask Pedro..."
            aria-label="Message Pedro"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
          />
          <button className="pedro-send" type="submit" disabled={sending || !input.trim()} aria-label="Send message">
            GO
          </button>
        </form>
      </div>

      <button
        className="pedro-launch"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? "Close Pedro chat" : "Open Pedro chat"}
        aria-expanded={open}
      >
        <span className="pedro-mark" aria-hidden="true">P</span>
      </button>
    </div>
  );
}
