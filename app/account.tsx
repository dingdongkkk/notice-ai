"use client";

import { useCallback, useEffect, useState } from "react";
import type { Language, Notice } from "@/lib/schema";
import { Icon } from "./icons";
import { useT } from "./lang";

export type User = { id: number; username: string };
export type SavedDocument = { id: number; created: string; language: Language; notice: Notice };

const SHAREABLE = ["water", "scholarship", "circular"];

async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Something went wrong. Please try again.");
  return data;
}

// Who is signed in. `undefined` while it is still being checked.
export function useSession() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const refresh = useCallback(() => {
    api("/api/auth")
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
  }, []);
  useEffect(refresh, [refresh]);
  return { user, refresh };
}

export function AccountBar({ user, onChange }: { user: User | null | undefined; onChange: () => void }) {
  const t = useT();
  if (user === undefined) return null;
  if (!user) {
    return (
      <a className="account-link" href="/login">
        <Icon name="home" size="1.05em" /> {t("Sign in")}
      </a>
    );
  }
  return (
    <div className="account">
      <span className="account-name" title={t("Signed in as {name}", { name: user.username })}>
        {user.username}
      </span>
      <button
        className="ghost small"
        onClick={() => api("/api/auth", "POST", { action: "logout" }).finally(onChange)}
      >
        {t("Sign out")}
      </button>
    </div>
  );
}

// Saves the facts on screen to the account, optionally adding a non-personal
// summary to the shared library. Nothing is saved until the button is pressed.
export function SaveCard({
  notice,
  language,
  user,
  onSaved,
}: {
  notice: Notice;
  language: Language;
  user: User | null | undefined;
  onSaved: () => void;
}) {
  const t = useT();
  const [share, setShare] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const shareable = SHAREABLE.includes(notice.category);

  async function save() {
    setState("saving");
    setError("");
    try {
      const out = await api("/api/documents", "POST", { notice, language, share: share && shareable });
      setMessage(
        !share || !shareable
          ? "Saved to your notices."
          : out.shared
            ? "Saved, and a general summary was added to the shared library."
            : "Saved. A summary of this kind of notice was already in the library.",
      );
      setState("done");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setState("idle");
    }
  }

  return (
    <section className="card tint-green" aria-labelledby="save">
      <h2 id="save" className="section-title">
        <span className="badge">
          <Icon name="check" />
        </span>
        {t("Save to my notices")}
      </h2>
      {!user ? (
        <>
          <p>{t("Sign in to save this notice and ask questions across all your notices.")}</p>
          <a className="button-link" href="/login">
            {t("Sign in")}
          </a>
        </>
      ) : state === "done" ? (
        <div className="banner ok" role="status">
          <span className="banner-icon">
            <Icon name="check" />
          </span>
          <div>{t(message)}</div>
        </div>
      ) : (
        <>
          <p>{t("Only the facts read from the notice are saved. The photo is not stored.")}</p>
          {shareable ? (
            <label className={`confirm${share ? " on" : ""}`}>
              <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
              <span>
                {t(
                  "Also add a general summary to the shared library, with no dates, names, numbers or areas, so others can learn what this kind of notice means.",
                )}
              </span>
            </label>
          ) : (
            <p className="muted">{t("Legal papers and unclassified documents are never shared.")}</p>
          )}
          <button onClick={save} disabled={state === "saving"}>
            {t(state === "saving" ? "Saving…" : "Save")}
          </button>
          {error && (
            <p className="form-error" role="alert">
              {t(error)}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function title(n: Notice) {
  return n.title ?? n.documentType ?? "Notice";
}

// Earlier saved notices that look related to the one on screen.
export function Related({
  notice,
  user,
  version,
  onOpen,
}: {
  notice: Notice;
  user: User | null | undefined;
  version: number;
  onOpen: (d: SavedDocument) => void;
}) {
  const t = useT();
  const [related, setRelated] = useState<SavedDocument[]>([]);
  useEffect(() => {
    if (!user) return;
    let current = true;
    api("/api/documents/related", "POST", { notice })
      .then((d) => current && setRelated(d.related ?? []))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [notice, user, version]);
  if (!user || related.length === 0) return null;
  return (
    <section className="card tint-blue" aria-labelledby="related">
      <h2 id="related" className="section-title">
        <span className="badge">
          <Icon name="refresh" />
        </span>
        {t("From your earlier notices")}
      </h2>
      <p className="muted">{t("You saved these related notices before.")}</p>
      <ul className="doc-list">
        {related.map((d) => (
          <li key={d.id}>
            <div>
              <strong lang={d.language}>{title(d.notice)}</strong>
              <span className="muted" lang={d.language}>
                {[d.notice.issuer, d.notice.eventDate].filter(Boolean).join(" · ")}
              </span>
            </div>
            <button className="ghost small" onClick={() => onOpen(d)}>
              {t("Open")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MyNotices({
  version,
  onOpen,
  onChange,
}: {
  version: number;
  onOpen: (d: SavedDocument) => void;
  onChange: () => void;
}) {
  const t = useT();
  const [documents, setDocuments] = useState<SavedDocument[] | null>(null);
  useEffect(() => {
    let current = true;
    api("/api/documents")
      .then((d) => current && setDocuments(d.documents))
      .catch(() => current && setDocuments([]));
    return () => {
      current = false;
    };
  }, [version]);

  return (
    <section className="card tint-violet" aria-labelledby="mine">
      <h2 id="mine" className="section-title">
        <span className="badge">
          <Icon name="list" />
        </span>
        {t("My notices")}
      </h2>
      {documents && documents.length === 0 && <p>{t("You have no saved notices yet.")}</p>}
      <ul className="doc-list">
        {(documents ?? []).map((d) => (
          <li key={d.id}>
            <div>
              <strong lang={d.language}>{title(d.notice)}</strong>
              <span className="muted">
                <span lang={d.language}>{d.notice.issuer}</span>{" "}
                {t("Saved on {d}", { d: d.created.slice(0, 10) })}
              </span>
            </div>
            <button className="ghost small" onClick={() => onOpen(d)}>
              {t("Open")}
            </button>
            <button
              className="ghost small"
              aria-label={`${t("Delete")}: ${title(d.notice)}`}
              onClick={() => api(`/api/documents?id=${d.id}`, "DELETE").finally(onChange)}
            >
              {t("Delete")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Source = { number: number; title: string; detail: string };

// A question box. `mine` searches the signed-in person's saved notices;
// otherwise it searches the shared library, which needs no sign-in.
export function AskBox({ mine, language }: { mine: boolean; language: Language }) {
  const t = useT();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (mine) return;
    api("/api/library")
      .then((d) => setCount(d.total))
      .catch(() => {});
  }, [mine]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || busy) return;
    setBusy(true);
    setError("");
    setAnswer("");
    try {
      const out = await api(mine ? "/api/documents/ask" : "/api/library", "POST", { question, language });
      setAnswer(out.answer);
      setSources(out.sources ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const id = mine ? "ask-mine" : "ask-library";
  return (
    <section className={`card ${mine ? "tint-blue" : "tint-amber"}`} aria-labelledby={id}>
      <h2 id={id} className="section-title">
        <span className="badge">
          <Icon name="chat" />
        </span>
        {t(mine ? "Ask across my notices" : "Ask what a notice means")}
      </h2>
      {!mine && (
        <p>
          {t(
            "No need to upload anything. Answers come from general summaries of notices other people have read.",
          )}{" "}
          {count !== null && <span className="muted">{t("{n} summaries in the library", { n: count })}</span>}
        </p>
      )}
      <form onSubmit={ask} className="ask">
        <label className="field">
          <span className="sr">{t("Your question")}</span>
          <input
            type="text"
            value={question}
            maxLength={300}
            placeholder={t(
              mine
                ? "e.g. Which of my notices have a deadline this month?"
                : "e.g. What does a water supply interruption notice mean?",
            )}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        <button disabled={busy || !question.trim()}>
          {t(busy ? "Asking…" : "Ask")}
          {!busy && <Icon name="arrow" />}
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {t(error)}
        </p>
      )}
      {answer && (
        <div role="status" className="answer-bubble">
          <p lang={language}>{answer}</p>
          <p className="muted">{t(mine ? "Notices consulted:" : "Summaries consulted:")}</p>
          <ol className="sources">
            {sources.map((s) => (
              <li key={s.number}>
                <strong>{s.title}</strong> <span className="muted">{s.detail}</span>
              </li>
            ))}
          </ol>
          <p className="muted">
            {t(
              mine
                ? "Answered by Gemma 4 from your saved notices only. It can be wrong."
                : "Answered by Gemma 4 from the shared library only. It is general information, not about your own notice.",
            )}
          </p>
        </div>
      )}
    </section>
  );
}
