"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkbookDefinition } from "@/lib/workbooks/definitions";
import { emptyResponse, parseResponse, type WorkbookResponse } from "@/lib/workbooks/responses";
import styles from "./workbook.module.css";

type SaveState = "loading" | "signed-out" | "load-error" | "saved" | "pending" | "saving" | "error" | "conflict";

export default function WorkbookClient({ workbook }: { workbook: WorkbookDefinition }) {
  const [response, setResponse] = useState(() => emptyResponse(workbook));
  const [state, setState] = useState<SaveState>("loading");
  const [message, setMessage] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const current = useRef(response);
  const revision = useRef(0);
  const saved = useRef(JSON.stringify(response));
  const saving = useRef(false);
  const blocked = useRef(true);
  const mounted = useRef(true);
  const endpoint = `/api/workbooks/${workbook.slug}`;

  const load = useCallback(async () => {
    setState("loading");
    blocked.current = true;
    try {
      const res = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const data = await res.json();
      if (!mounted.current) return;
      if (res.status === 401 || res.status === 403) { setState("signed-out"); return; }
      if (!res.ok) throw new Error(data.error);
      const parsed = parseResponse(data.response, workbook);
      if (!parsed || !Number.isSafeInteger(data.revision) || data.revision < 0) throw new Error("Could not read your saved workbook.");
      current.current = parsed;
      saved.current = JSON.stringify(parsed);
      revision.current = data.revision;
      setResponse(parsed);
      setUpdatedAt(data.updatedAt);
      setState("saved");
      blocked.current = false;
    } catch (error) {
      if (!mounted.current) return;
      setMessage(error instanceof Error ? error.message : "Could not load your workbook. Please retry.");
      setState("load-error");
    }
  }, [endpoint, workbook]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  const save = useCallback(async () => {
    if (saving.current || blocked.current || saved.current === JSON.stringify(current.current)) return;
    saving.current = true;
    const snapshot = JSON.stringify(current.current);
    setState("saving");
    try {
      const res = await fetch(endpoint, {
        method: "PUT", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: JSON.parse(snapshot), revision: revision.current }),
      });
      const data = await res.json();
      if (!mounted.current) return;
      if (!res.ok) {
        setMessage(data.error || "Could not save. Please retry before leaving.");
        if (res.status === 409) { blocked.current = true; setState("conflict"); }
        else setState("error");
        return;
      }
      revision.current = data.revision;
      saved.current = snapshot;
      setUpdatedAt(data.updatedAt);
      setState(snapshot === JSON.stringify(current.current) ? "saved" : "pending");
    } catch {
      if (mounted.current) {
        setMessage("Connection interrupted. Your edits are still on this page. Retry before leaving.");
        setState("error");
      }
    } finally { saving.current = false; }
  }, [endpoint]);

  useEffect(() => {
    if (state !== "pending") return;
    const timer = window.setTimeout(() => { void save(); }, 800);
    return () => window.clearTimeout(timer);
  }, [response, state, save]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saved.current !== JSON.stringify(current.current)) { event.preventDefault(); event.returnValue = ""; }
    };
    const reconnect = () => { if (state === "error") void save(); };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("online", reconnect);
    return () => { window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("online", reconnect); };
  }, [state, save]);

  function edit(next: WorkbookResponse) {
    current.current = next;
    setResponse(next);
    // Keep actionable failures visible until an explicit retry succeeds.
    if (!saving.current && state !== "error" && state !== "conflict") setState("pending");
  }

  const enabled = !["loading", "signed-out", "load-error"].includes(state);
  const answered = workbook.prompts.filter(({ id }) => response.answers[id].trim()).length;
  const evidenceComplete = response.evidence.filter((entry) => entry.date && entry.action.trim()).length;
  const commitment = response.answers[workbook.commitmentId].trim();
  const status = state === "saving" ? "Saving…" : state === "pending" ? "Unsaved changes" : state === "saved" ? (updatedAt ? "All changes saved to your account" : "Ready when you are") : state === "loading" ? "Opening your workbook…" : state === "signed-out" ? "Sign in to write and save" : "Your attention is needed";

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <a href="/library" className={styles.brand}>Long<span>board.</span></a>
        <span className={styles.topLabel}>THE WORKBOOKS</span>
        <a href="/library" className={styles.back}>← Member library</a>
      </header>
      <div className={styles.wrap}>
        <div className={styles.hero}>
          <p className={styles.eyebrow}>{workbook.event}</p>
          <p className={styles.issue}>FIELD NOTES / 01 <span>READ · REFLECT · ACT</span></p>
          <h1>{workbook.title}</h1>
          <p className={styles.subtitle}>{workbook.subtitle}</p>
          <div className={styles.heroBottom}><span>By Rob Booker</span><span>A small action. Then the evidence.</span></div>
        </div>

        <div className={styles.columns}>
          <div className={styles.content}>
            <section id="lesson" className={styles.lesson} aria-labelledby="lesson-title">
              <h2 id="lesson-title" className={styles.sectionLabel}>01 / THE IDEA</h2>
              {workbook.introduction.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
              <div className={styles.comparison}>
                <h3>The order most traders use — and the order that works</h3>
                <div><span>BACKWARDS</span><p>{workbook.comparison.backwards}</p></div>
                <div><span>FORWARDS</span><p>{workbook.comparison.forwards}</p></div>
              </div>
              <a href="#reflect" className={styles.start}>Make it personal <span>↓</span></a>
            </section>

            <section id="reflect" className={styles.reflections} aria-labelledby="reflect-title">
              <h2 id="reflect-title" className={styles.sectionLabel}>02 / MAKE IT PERSONAL</h2>
              <h3 className={styles.sectionTitle}>Start where you are.</h3>
              <p className={styles.sectionIntro}>You don’t need the perfect answer. Write what’s true today.</p>
              {state === "signed-out" && <div className={styles.notice}><p>Your workbook is private to your account. Sign in to write your answers and return to them on any device.</p><a className={styles.button} href={`/login?next=${encodeURIComponent(`/workbooks/${workbook.slug}`)}`}>Sign in & begin →</a></div>}
              {state === "load-error" && <div className={styles.notice} role="alert"><p>{message}</p><button className={styles.button} onClick={() => void load()}>Try loading again</button></div>}
              <fieldset disabled={!enabled} className={styles.fields}>
                <legend className={styles.srOnly}>Your reflections</legend>
                {workbook.prompts.map((prompt, index) => <div className={styles.prompt} key={prompt.id}>
                  <span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <label htmlFor={prompt.id}>{prompt.title}</label>
                    <p id={`${prompt.id}-hint`} className={styles.hint}>{prompt.hint}</p>
                    <textarea id={prompt.id} aria-describedby={`${prompt.id}-hint`} rows={4} maxLength={5000} placeholder={prompt.placeholder} value={response.answers[prompt.id]} onChange={(event) => edit({ ...current.current, answers: { ...current.current.answers, [prompt.id]: event.target.value } })} />
                    <div className={styles.printAnswer}>{response.answers[prompt.id] || "Not answered yet."}</div>
                  </div>
                </div>)}
              </fieldset>
            </section>

            <section id="evidence" className={styles.evidence} aria-labelledby="evidence-title">
              <h2 className={styles.sectionLabel}>03 / COLLECT THE EVIDENCE</h2>
              <h3 id="evidence-title" className={styles.sectionTitle}>{workbook.evidenceTitle}</h3>
              <p className={styles.sectionIntro}>{workbook.evidenceHint}</p>
              <fieldset disabled={!enabled} className={styles.fields}>
                <legend className={styles.srOnly}>Your evidence log</legend>
                {response.evidence.map((entry, index) => {
                  const update = (key: keyof typeof entry, value: string) => edit({ ...current.current, evidence: current.current.evidence.map((item, i) => i === index ? { ...item, [key]: value } : item) });
                  return <div className={styles.evidenceCard} key={index}>
                    <div className={styles.evidenceHeader}><h4>Evidence {String(index + 1).padStart(2, "0")}</h4><span>{entry.date && entry.action.trim() ? "Recorded ✓" : "Waiting for a small action"}</span></div>
                    <label htmlFor={`date-${index}`}>When did you act?</label>
                    <input id={`date-${index}`} type="date" value={entry.date} onChange={(event) => update("date", event.target.value)} />
                    <div className={styles.printAnswer}>{entry.date || "No date yet."}</div>
                    <label htmlFor={`evidence-${index}`}>What did you do before you felt ready?</label>
                    <textarea id={`evidence-${index}`} rows={3} maxLength={5000} placeholder="The action I actually took…" value={entry.action} onChange={(event) => update("action", event.target.value)} />
                    <div className={styles.printAnswer}>{entry.action || "Not recorded yet."}</div>
                    <label htmlFor={`reflection-${index}`}>What did you notice afterward? <span className={styles.optional}>(optional)</span></label>
                    <textarea id={`reflection-${index}`} rows={2} maxLength={5000} placeholder="What happened, what changed, or what I learned…" value={entry.reflection} onChange={(event) => update("reflection", event.target.value)} />
                    <div className={styles.printAnswer}>{entry.reflection || "—"}</div>
                  </div>;
                })}
              </fieldset>
            </section>
            <blockquote className={styles.closing}>{workbook.closing}</blockquote>
            <footer className={styles.footer}>Longboard Workbooks <span>Keep showing up.</span></footer>
          </div>

          <aside className={styles.sidebar} aria-label="Your workbook progress">
            <div className={styles.sticky}>
              <p className={styles.sectionLabel}>YOUR WORKBOOK</p>
              <nav className={styles.navigation} aria-label="Workbook sections"><a href="#lesson">01 <span>The idea</span> ↗</a><a href="#reflect">02 <span>Your reflections</span> ↗</a><a href="#evidence">03 <span>The evidence</span> ↗</a></nav>
              <div className={styles.progress}><span>{answered} of {workbook.prompts.length} reflections</span><progress max={workbook.prompts.length} value={answered} aria-label="Reflections answered" /><span>{evidenceComplete} of {workbook.evidenceCount} actions recorded</span><progress max={workbook.evidenceCount} value={evidenceComplete} aria-label="Evidence recorded" /></div>
              <div className={styles.commitment}><p className={styles.sectionLabel}>MY NEXT SMALL ACTION</p><p>{commitment || "Your commitment will live here. Start with the third reflection."}</p>{!commitment && <a href="#action">Choose your action →</a>}</div>
              <div className={styles.saveStatus} role="status" aria-live="polite"><span className={state === "saved" ? styles.savedDot : styles.dot} />{status}</div>
              {(state === "error" || state === "conflict") && <div className={styles.error} role="alert"><p>{message}</p>{state === "error" && <button onClick={() => void save()}>Retry saving</button>}{state === "conflict" && <button onClick={() => window.location.reload()}>Reload saved version</button>}</div>}
              {enabled && <button className={styles.printButton} onClick={() => window.print()}>Print / Save as PDF ↗</button>}
              <p className={styles.privacy}>Your answers are saved to your account and aren’t shared with other attendees.</p>
              {evidenceComplete === workbook.evidenceCount && <p className={styles.complete}>Three actions. Real evidence. Come back and read what you’ve built.</p>}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
