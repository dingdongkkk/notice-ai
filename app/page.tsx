"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import {
  EMPTY_PROFILE,
  buildCard,
  buildIcs,
  checkRelevance,
  compareNotices,
  formatWhen,
  planUpdates,
  saveReminder,
  type ConfirmedEvent,
  type Outcome,
  type Profile,
  type SavedReminder,
  type YesNo,
} from "@/lib/actions";
import {
  FIXTURE_SCHOLARSHIP,
  FIXTURE_WATER,
  FIXTURE_WATER_REVISED,
  findRecords,
} from "@/lib/data";
import { CARD_LABELS } from "@/lib/i18n";
import { LANGUAGES, isIsoDate, isTime, type Language, type Notice } from "@/lib/schema";
import { useStored } from "@/lib/store";

type Result = {
  notice: Notice;
  image: string | null;
  source: "live" | "fixture";
  language: Language;
  model?: string;
};
type Thread = { id: string; original: Result; revised: Result | null };

const NO_REMINDERS: SavedReminder[] = [];
const SCALES = [
  { value: 1, label: "A", name: "Normal text" },
  { value: 1.2, label: "A+", name: "Large text" },
  { value: 1.4, label: "A++", name: "Very large text" },
];

// Downscale in the browser so small Kannada text stays legible but the upload stays small.
async function toDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.88);
}

async function extract(file: File, language: Language): Promise<Result> {
  const image = await toDataUrl(file);
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image, language }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.notice) {
    throw new Error(body?.error || "Something went wrong. Please try again.");
  }
  return { notice: body.notice, image, source: "live", language, model: body.model };
}

function download(name: string, content: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const TAGS = {
  notice: "From your notice",
  external: "External source",
  confirm: "Needs confirmation",
  ai: "AI suggestion, not in the notice",
} as const;

function Tag({ kind }: { kind: keyof typeof TAGS }) {
  return <span className={`tag ${kind}`}>{TAGS[kind]}</span>;
}

// "Show me where": the passages the model says support a fact, plus a jump to the photo.
function Proof({ notice, fields }: { notice: Notice; fields: string[] }) {
  const [open, setOpen] = useState(false);
  const quotes = notice.evidence.filter((e) => fields.includes(e.field));
  return (
    <div className="proof">
      <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide proof" : "Show me where"}
      </button>
      {open && (
        <div className="proof-body">
          {quotes.length === 0 ? (
            <p>The AI gave no passage for this. Please check the photo yourself.</p>
          ) : (
            quotes.map((q, i) => (
              <blockquote key={i} lang={notice.originalLanguage === "Kannada" ? "kn" : undefined}>
                {q.quote}
              </blockquote>
            ))
          )}
          <p className="muted">
            This is the AI&apos;s reading of the notice. <a href="#photo">Compare with the photo</a>.
          </p>
        </div>
      )}
    </div>
  );
}

function ReadAloud({ text, language }: { text: string; language: Language }) {
  const [state, setState] = useState<"idle" | "speaking" | "unavailable">("idle");
  function toggle() {
    if (!("speechSynthesis" in window)) return setState("unavailable");
    window.speechSynthesis.cancel();
    if (state === "speaking") return setState("idle");
    const speech = LANGUAGES[language].speech;
    const voices = window.speechSynthesis.getVoices();
    // Without a matching voice the browser would read Kannada or Hindi with an English voice.
    if (voices.length > 0 && !voices.some((v) => v.lang.replace("_", "-").startsWith(speech.slice(0, 2)))) {
      return setState("unavailable");
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = speech;
    u.rate = 0.9;
    u.onend = () => setState("idle");
    u.onerror = () => setState("idle");
    setState("speaking");
    window.speechSynthesis.speak(u);
  }
  return (
    <>
      <button className="ghost" onClick={toggle}>
        {state === "speaking" ? "■ Stop reading" : "🔊 Read aloud"}
      </button>
      {state === "unavailable" && (
        <p className="muted" role="status">
          This device has no {LANGUAGES[language].name} voice installed.
        </p>
      )}
    </>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="card" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

function Choice({
  legend,
  value,
  onChange,
}: {
  legend: string;
  value: YesNo;
  onChange: (v: YesNo) => void;
}) {
  return (
    <fieldset className="choice">
      <legend>{legend}</legend>
      {(["yes", "no", ""] as YesNo[]).map((v) => (
        <label key={v || "skip"} className={value === v ? "on" : ""}>
          <input
            type="radio"
            name={legend}
            checked={value === v}
            onChange={() => onChange(v)}
          />
          {v === "yes" ? "Yes" : v === "no" ? "No" : "Skip"}
        </label>
      ))}
    </fieldset>
  );
}

const OUTCOMES: Record<Outcome, { label: string; cls: string; icon: string }> = {
  match: { label: "Matches the stated conditions", cls: "bad", icon: "●" },
  "no-match": { label: "Doesn't match a stated condition", cls: "ok", icon: "○" },
  unknown: { label: "Need more information", cls: "warn", icon: "?" },
};

function Household({
  notice,
  profile,
  setProfile,
}: {
  notice: Notice;
  profile: Profile;
  setProfile: (p: Profile) => void;
}) {
  const { outcome, checks } = checkRelevance(notice, profile);
  const o = OUTCOMES[outcome];
  // A match on a water cut is bad news; a match on a scholarship is good news.
  const tone = notice.category === "scholarship" ? (outcome === "match" ? "ok" : outcome === "no-match" ? "bad" : "warn") : o.cls;
  return (
    <Section id="household" title="Does this affect my family?">
      <div className={`banner ${tone} big`} role="status">
        <span aria-hidden="true">{o.icon} </span>
        <strong>{o.label}</strong>
        {outcome !== "unknown" && (
          <>
            <br />
            {notice.category === "scholarship"
              ? outcome === "match"
                ? "Your household appears to meet what the notice asks."
                : "Your household may not meet what the notice asks."
              : outcome === "match"
                ? "This is likely to affect your household."
                : "This may not affect your household."}
          </>
        )}
      </div>
      {checks.length === 0 ? (
        <p>The notice states no areas or conditions that can be checked.</p>
      ) : (
        <ul className="reasons">
          {checks.map((c, i) => (
            <li key={i}>
              <span className={`dot ${c.outcome}`} aria-hidden="true" />
              <div>
                <p>{c.reason}</p>
                <Proof notice={notice} fields={[c.field]} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">
        This is a simple comparison, not a final decision on eligibility. Confirm with the issuer.
      </p>
      <details open={!profile.locality}>
        <summary>My household details</summary>
        <p className="muted">
          Optional. Kept only in this browser and never sent to the AI. No ID numbers are needed.
        </p>
        <label className="field">
          Locality or area name
          <input
            type="text"
            value={profile.locality}
            autoComplete="address-level3"
            placeholder="e.g. Mathikere"
            onChange={(e) => setProfile({ ...profile, locality: e.target.value })}
          />
        </label>
        <label className="field">
          Water provider
          <select
            value={profile.provider}
            onChange={(e) => setProfile({ ...profile, provider: e.target.value as Profile["provider"] })}
          >
            <option value="">Not sure</option>
            <option value="bwssb">BWSSB (Cauvery water)</option>
            <option value="other">Another provider, borewell or tanker</option>
          </select>
        </label>
        <Choice
          legend="Is there a student in the household?"
          value={profile.student}
          onChange={(student) => setProfile({ ...profile, student })}
        />
        <Choice
          legend="Is there a senior citizen in the household?"
          value={profile.senior}
          onChange={(senior) => setProfile({ ...profile, senior })}
        />
      </details>
    </Section>
  );
}

function CheckList({ items, lang }: { items: string[]; lang: Language }) {
  const [done, setDone] = useState<string[]>([]);
  return (
    <ul className="checklist" lang={lang}>
      {items.map((item) => (
        <li key={item}>
          <label>
            <input
              type="checkbox"
              checked={done.includes(item)}
              onChange={(e) => setDone(e.target.checked ? [...done, item] : done.filter((d) => d !== item))}
            />
            <span>{item}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function VisitReadiness({ notice, lang }: { notice: Notice; lang: Language }) {
  const [have, setHave] = useState<string[]>([]);
  const offices = findRecords(notice).filter((r) => r.kind === "office");
  const docs = notice.documentsRequired;
  if (docs.length === 0 && !notice.officeLocation) return null;
  const missing = docs.length - have.length;
  return (
    <Section id="visit" title="Before you leave home">
      {docs.length > 0 && (
        <>
          <h3>
            Documents to carry <Tag kind="notice" />
          </h3>
          <p className="muted">Tick each one you already have.</p>
          <ul className="checklist" lang={lang}>
            {docs.map((d) => (
              <li key={d}>
                <label>
                  <input
                    type="checkbox"
                    checked={have.includes(d)}
                    onChange={(e) => setHave(e.target.checked ? [...have, d] : have.filter((x) => x !== d))}
                  />
                  <span>{d}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className={`banner ${missing === 0 ? "ok" : "warn"}`} role="status">
            {missing === 0
              ? "You have ticked every listed document."
              : `${missing} of ${docs.length} documents still to collect.`}
          </div>
          <Proof notice={notice} fields={["documents"]} />
        </>
      )}
      <h3>Where to go</h3>
      {notice.officeLocation ? (
        <>
          <p lang={lang}>
            {notice.officeLocation} <Tag kind="notice" />
          </p>
          <Proof notice={notice} fields={["office"]} />
        </>
      ) : (
        <p>The notice does not name an office.</p>
      )}
      {offices.map((r) => (
        <div key={r.service} className="external">
          <p>
            <strong>{r.service}</strong> <Tag kind="external" />
            <br />
            {r.detail}
          </p>
          <p className="muted">
            {r.matchRule} <a href={r.sourceUrl} target="_blank" rel="noreferrer">Source</a>, retrieved{" "}
            {r.retrieved}.
          </p>
        </div>
      ))}
      <div className="banner warn">
        {offices.some((r) => r.hours)
          ? "Opening hours come from an outside source. Confirm before travelling."
          : "Opening hours unavailable. Confirm before travelling."}
      </div>
    </Section>
  );
}

function Ask({ notice, language }: { notice: Notice; language: Language }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || busy) return;
    setBusy(true);
    setError("");
    setAnswer("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notice, question, language }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.answer) throw new Error(body?.error || "Something went wrong. Please try again.");
      setAnswer(body.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section id="ask" title="Ask a question about this notice">
      <form onSubmit={ask}>
        <label className="field">
          Your question
          <input
            type="text"
            value={question}
            maxLength={300}
            placeholder="e.g. Will tankers be arranged?"
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        <button disabled={busy || !question.trim()}>{busy ? "Asking…" : "Ask"}</button>
      </form>
      {error && <div className="banner bad" role="alert">{error}</div>}
      {answer && (
        <div role="status">
          <blockquote lang={language}>{answer}</blockquote>
          <p className="muted">
            Answered by Gemma 4 using only the facts read from the notice. It can be wrong.
          </p>
        </div>
      )}
    </Section>
  );
}

function Flow({
  thread,
  result,
  profile,
  setProfile,
  reminders,
  setReminders,
}: {
  thread: Thread;
  result: Result;
  profile: Profile;
  setProfile: (p: Profile) => void;
  reminders: SavedReminder[];
  setReminders: (r: SavedReminder[]) => void;
}) {
  const n = result.notice;
  const lang = result.language;
  const [date, setDate] = useState(n.eventDate ?? "");
  const [start, setStart] = useState(n.startTime ?? "");
  const [end, setEnd] = useState(n.endTime ?? "");
  const [checked, setChecked] = useState(false);
  const [hidePersonal, setHidePersonal] = useState(true);
  const [status, setStatus] = useState("");

  const confirmed: ConfirmedEvent | null =
    checked && isIsoDate(date)
      ? { date, startTime: isTime(start) ? start : null, endTime: isTime(end) ? end : null }
      : null;
  const saved = reminders.find((r) => r.threadId === thread.id) ?? null;
  const records = findRecords(n);
  const helplines = records.filter((r) => r.kind === "helpline");
  const dateLabel = n.dateKind === "deadline" ? "Deadline" : "When";
  const whenText = confirmed
    ? formatWhen(confirmed, lang)
    : n.eventDate
      ? formatWhen({ date: n.eventDate, startTime: n.startTime, endTime: n.endTime }, lang)
      : null;

  const card = buildCard(n, confirmed, lang, hidePersonal);
  const L = CARD_LABELS[lang];
  const cardText = [
    `${L.happened}: ${card.happened}`,
    `${L.when}: ${card.when}`,
    card.where ? `${L.where}: ${card.where}` : "",
    card.official.length ? `${L.todo} (${L.official}):\n${card.official.map((x) => `- ${x}`).join("\n")}` : "",
    card.suggested.length ? `${L.suggested}:\n${card.suggested.map((x) => `- ${x}`).join("\n")}` : "",
    `${L.source}: ${card.source}`,
    `${L.madeOn}: ${card.madeOn}`,
    L.disclaimer,
  ]
    .filter(Boolean)
    .join("\n\n");

  function approve() {
    if (!confirmed) return;
    const out = saveReminder(reminders, thread.id, n, confirmed);
    if (out.status !== "unchanged") setReminders(out.list);
    download(
      `notice-${confirmed.date}.ics`,
      buildIcs(n, confirmed, out.reminder.uid, out.reminder.sequence),
      "text/calendar",
    );
    setStatus(
      out.status === "created"
        ? "Reminder saved and calendar file downloaded. Open the file to add it to your calendar."
        : out.status === "updated"
          ? `Reminder updated from ${formatWhen(out.previous!)} to ${formatWhen(confirmed)}. No second reminder was created. Open the downloaded file to update your calendar.`
          : "This reminder was already saved, so nothing new was added. The calendar file was downloaded again.",
    );
  }

  async function copyCard() {
    try {
      await navigator.clipboard.writeText(cardText);
      setStatus("Card copied. Paste it into a message to share it.");
    } catch {
      setStatus("Could not copy automatically. Please select the text and copy it.");
    }
  }

  async function shareCard() {
    if (!navigator.share) return copyCard();
    try {
      await navigator.share({ text: cardText });
    } catch {}
  }

  const facts: { label: string; value: string | null; fields: string[] }[] = [
    { label: "Issued by", value: n.issuer, fields: ["issuer"] },
    { label: "Areas", value: n.affectedAreas.join(", ") || null, fields: ["affectedAreas"] },
    { label: "Amount", value: n.amount, fields: ["amount"] },
    { label: "Reference", value: n.referenceNumber, fields: [] },
  ];

  return (
    <>
      <section className="card answer" aria-labelledby="answer">
        <p className="eyebrow">{n.documentType ?? "Notice"}</p>
        <h2 id="answer" lang={lang}>
          {n.headline ?? n.title ?? "Here is what the notice says"}
        </h2>
        <p className="when">
          <span className="eyebrow">{dateLabel}</span>
          {whenText ? (
            <span lang={lang}>{whenText}</span>
          ) : (
            <span>Not readable. Please check the notice.</span>
          )}{" "}
          <Tag kind={n.eventDate && n.unresolved.length === 0 ? "notice" : "confirm"} />
        </p>
        {n.dateText && <p className="muted">As written in the notice: {n.dateText}</p>}
        <Proof notice={n} fields={["date", "time"]} />
        <p lang={lang}>{n.explanation}</p>
        <ReadAloud text={[n.headline, n.explanation, ...n.requirements].filter(Boolean).join(". ")} language={lang} />
        {n.unresolved.length > 0 && (
          <div className="banner warn">
            <strong>Needs your confirmation</strong>
            <ul>
              {n.unresolved.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <Household notice={n} profile={profile} setProfile={setProfile} />

      <Section id="todo" title="What to do">
        {n.requirements.length > 0 ? (
          <>
            <h3>
              The notice asks you to <Tag kind="notice" />
            </h3>
            <CheckList items={n.requirements} lang={lang} />
            <Proof notice={n} fields={["requirements"]} />
          </>
        ) : (
          <p>The notice does not ask you to do anything specific.</p>
        )}
        {n.suggestions.length > 0 && (
          <>
            <h3>
              You may also want to <Tag kind="ai" />
            </h3>
            <CheckList items={n.suggestions} lang={lang} />
          </>
        )}
      </Section>

      <VisitReadiness notice={n} lang={lang} />

      <Section id="reminder" title="Set a reminder">
        {saved && (
          <div className="banner ok">
            Saved reminder: <strong>{formatWhen(saved)}</strong>
          </div>
        )}
        {saved && isIsoDate(date) && (saved.date !== date || (saved.startTime ?? "") !== start) && (
          <div className="banner warn">
            Your saved reminder shows the earlier date. Confirm the new date below to update it.
          </div>
        )}
        <p>Check the date against the notice, then approve. Nothing is saved before you approve.</p>
        <div className="fields">
          <label className="field">
            Date
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setChecked(false);
              }}
            />
          </label>
          <label className="field">
            From
            <input type="time" value={start} onChange={(e) => { setStart(e.target.value); setChecked(false); }} />
          </label>
          <label className="field">
            To
            <input type="time" value={end} onChange={(e) => { setEnd(e.target.value); setChecked(false); }} />
          </label>
        </div>
        {!isIsoDate(date) && (
          <div className="banner warn">
            The date could not be read. Type it in from the notice to set a reminder.
          </div>
        )}
        <label className="confirm">
          <input
            type="checkbox"
            checked={checked}
            disabled={!isIsoDate(date)}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span>I have checked this date and time against the notice</span>
        </label>
        <button onClick={approve} disabled={!confirmed}>
          {saved ? "Approve and update reminder" : "Approve and download reminder"}
        </button>
        <p className="muted">The reminder rings 12 hours before.</p>
      </Section>

      <Section id="family" title="Card for my family">
        <div className="family-card" lang={lang}>
          <h3>{L.happened}</h3>
          <p>{card.happened}</p>
          <h3>{L.when}</h3>
          <p>{card.when}</p>
          {card.where && (
            <>
              <h3>{L.where}</h3>
              <p>{card.where}</p>
            </>
          )}
          {card.official.length > 0 && (
            <>
              <h3>{L.todo}</h3>
              <p className="sub">{L.official}</p>
              <ul>
                {card.official.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          )}
          {card.suggested.length > 0 && (
            <>
              <p className="sub">{L.suggested}</p>
              <ul>
                {card.suggested.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          )}
          <p className="sub">
            {L.source}: {card.source}
            <br />
            {L.madeOn}: {card.madeOn}
            <br />
            {L.disclaimer}
          </p>
        </div>
        <label className="confirm">
          <input type="checkbox" checked={hidePersonal} onChange={(e) => setHidePersonal(e.target.checked)} />
          <span>Hide names, account numbers and addresses</span>
        </label>
        <p className="muted">Read the card before you share it. Sharing happens only when you press a button.</p>
        <div className="actions">
          <button onClick={shareCard}>Share card</button>
          <button className="ghost" onClick={copyCard}>Copy text</button>
          <ReadAloud text={cardText} language={lang} />
        </div>
      </Section>

      {status && <div className="banner ok" role="status">{status}</div>}

      <Section id="proof" title="Proof: the facts and the photo">
        <ul className="facts">
          {facts
            .filter((f) => f.value)
            .map((f) => (
              <li key={f.label}>
                <span className="eyebrow">{f.label}</span>
                <span>
                  {f.value} <Tag kind="notice" />
                </span>
                {f.fields.length > 0 && <Proof notice={n} fields={f.fields} />}
              </li>
            ))}
        </ul>
        <div id="photo" tabIndex={-1}>
          {result.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="preview" src={result.image} alt="The notice you uploaded" />
          ) : (
            <p className="muted">This is a synthetic sample, so there is no photo.</p>
          )}
        </div>
      </Section>

      <Section id="external" title="Helpful contacts">
        {helplines.length === 0 && <p>No matching public record was found for this notice.</p>}
        {helplines.map((r) => (
          <div key={r.service} className="external">
            <p>
              <strong>{r.service}</strong> <Tag kind="external" />
              <br />
              {r.detail}
            </p>
            <p className="muted">
              Shown because: {r.matchRule}{" "}
              <a href={r.sourceUrl} target="_blank" rel="noreferrer">Source</a>, retrieved {r.retrieved}.
            </p>
          </div>
        ))}
      </Section>

      <Ask notice={n} language={lang} />
      {result.model && <p className="muted">Read by {result.model}.</p>}
    </>
  );
}

export default function Home() {
  const [language, setLanguage] = useStored<Language>("nta.language", "en");
  const [scale, setScale] = useStored<number>("nta.scale", 1);
  const [profile, setProfile] = useStored<Profile>("nta.profile", EMPTY_PROFILE);
  const [reminders, setReminders] = useStored<SavedReminder[]>("nta.reminders", NO_REMINDERS);
  const [thread, setThread] = useState<Thread | null>(null);
  const [busy, setBusy] = useState<"original" | "revised" | null>(null);
  const [error, setError] = useState("");

  async function onFile(file: File | undefined, slot: "original" | "revised") {
    if (!file) return;
    setError("");
    setBusy(slot);
    try {
      const result = await extract(file, language);
      if (slot === "revised" && thread) setThread({ ...thread, revised: result });
      else setThread({ id: crypto.randomUUID(), original: result, revised: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  function loadFixture(notice: Notice) {
    setError("");
    setThread({
      id: crypto.randomUUID(),
      original: { notice, image: null, source: "fixture", language: "en" },
      revised: null,
    });
  }

  const current = thread ? (thread.revised ?? thread.original) : null;
  const changes = thread?.revised ? compareNotices(thread.original.notice, thread.revised.notice) : null;
  const updates = changes ? planUpdates(changes) : [];
  const fixture = current?.source === "fixture";

  const picker = (slot: "original" | "revised", capture: boolean, label: string, ghost = false) => (
    <label className={`file${ghost ? " ghost" : ""}`}>
      {busy === slot ? "Reading…" : label}
      <input
        type="file"
        accept="image/*"
        capture={capture ? "environment" : undefined}
        disabled={busy !== null}
        onChange={(e) => {
          onFile(e.target.files?.[0], slot);
          e.target.value = "";
        }}
      />
    </label>
  );

  return (
    <main style={{ "--scale": scale } as CSSProperties}>
      <a className="skip" href="#start">Skip to upload</a>
      <header className="hero">
        <h1>Notice → Action</h1>
        <p>
          Know what a notice means for your household, what changed, and what to do next, with
          proof.
        </p>
      </header>

      <div className="toolbar">
        <div role="group" aria-label="Text size" className="sizes">
          {SCALES.map((s) => (
            <button
              key={s.value}
              className={scale === s.value ? "" : "ghost"}
              aria-pressed={scale === s.value}
              aria-label={s.name}
              onClick={() => setScale(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="field inline">
          Explain in
          <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
            {(Object.keys(LANGUAGES) as Language[]).map((l) => (
              <option key={l} value={l}>
                {LANGUAGES[l].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="card" id="start" aria-labelledby="start-title">
        <h2 id="start-title">
          <span className="step">1</span> Show us the notice
        </h2>
        <div className="actions">
          {picker("original", true, "📷 Take a photo")}
          {picker("original", false, "🖼 Choose a photo", true)}
        </div>
        {busy && (
          <p role="status" className="busy">
            Reading the notice. This can take up to a minute. Please wait.
          </p>
        )}
        <p className="muted">
          Your photo is sent to a hosted AI service (Gemma 4 through OpenRouter) to be read. Do not
          upload private documents. Your household details and reminders stay in this browser.
          This is not an official government service.
        </p>
        <details>
          <summary>No notice at hand? Try a sample</summary>
          <p className="muted">Hand-written samples. No AI is used for these.</p>
          <div className="actions">
            <button className="ghost" onClick={() => loadFixture(FIXTURE_WATER)} disabled={busy !== null}>
              Sample water-cut notice
            </button>
            <button className="ghost" onClick={() => loadFixture(FIXTURE_SCHOLARSHIP)} disabled={busy !== null}>
              Sample scholarship notice
            </button>
          </div>
        </details>
      </section>

      {error && <div className="banner bad" role="alert">{error}</div>}

      {thread && current && (
        <>
          <h2 className="divider">
            <span className="step">2</span> What it means for you
          </h2>
          {fixture && (
            <div className="banner bad">
              SAMPLE: this is a hand-written synthetic notice. It is not AI output and not a real
              notice.
            </div>
          )}

          {changes && (
            <section className="card changed" aria-labelledby="changed">
              <h2 id="changed">What changed?</h2>
              {changes.length === 0 ? (
                <p>Nothing important changed: the date, time, areas, office and documents are the same.</p>
              ) : (
                <>
                  <ul className="changes">
                    {changes.map((c) => (
                      <li key={c.field}>
                        <p>{c.sentence}</p>
                        <Proof notice={current.notice} fields={[c.field]} />
                      </li>
                    ))}
                  </ul>
                  {updates.length > 0 && (
                    <div className="banner warn big" role="status">
                      Your plan needs {updates.length} update{updates.length === 1 ? "" : "s"}:{" "}
                      {updates.join(", ")}.
                    </div>
                  )}
                </>
              )}
              <p className="muted">Everything below now shows the newer notice.</p>
            </section>
          )}

          <Flow
            key={`${thread.id}-${thread.revised ? "r" : "o"}`}
            thread={thread}
            result={current}
            profile={profile}
            setProfile={setProfile}
            reminders={reminders}
            setReminders={setReminders}
          />

          <section className="card" aria-labelledby="revise">
            <h2 id="revise">
              <span className="step">3</span> Got a corrected notice later?
            </h2>
            <p>
              Add the newer notice here only if it replaces the one above. We will show what changed
              and help you update your reminder.
            </p>
            <div className="actions">
              {picker("revised", true, "📷 Photo of the new notice")}
              {picker("revised", false, "🖼 Choose a photo", true)}
              {thread.original.notice === FIXTURE_WATER && !thread.revised && (
                <button
                  className="ghost"
                  onClick={() =>
                    setThread({
                      ...thread,
                      revised: { notice: FIXTURE_WATER_REVISED, image: null, source: "fixture", language: "en" },
                    })
                  }
                >
                  Sample corrected notice
                </button>
              )}
            </div>
          </section>
        </>
      )}

      {reminders.length > 0 && (
        <section className="card" aria-labelledby="saved">
          <h2 id="saved">My saved reminders</h2>
          <ul className="saved">
            {reminders.map((r) => (
              <li key={r.threadId}>
                <div>
                  <strong>{r.title}</strong>
                  <br />
                  {formatWhen(r)}
                  {r.sequence > 0 && <span className="muted"> (updated {r.sequence}×)</span>}
                </div>
                <button
                  className="ghost"
                  aria-label={`Remove reminder for ${r.title}`}
                  onClick={() => setReminders(reminders.filter((x) => x.threadId !== r.threadId))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <p className="muted">Kept only in this browser. Removing one here does not change your calendar.</p>
        </section>
      )}
    </main>
  );
}
