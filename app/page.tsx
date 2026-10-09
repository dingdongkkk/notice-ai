"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";
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
  FIXTURE_CIRCULAR,
  FIXTURE_LEGAL,
  FIXTURE_SCHOLARSHIP,
  FIXTURE_WATER,
  FIXTURE_WATER_REVISED,
  findRecords,
} from "@/lib/data";
import { CARD_LABELS } from "@/lib/i18n";
import { LANGUAGES, isIsoDate, isTime, type Language, type Notice } from "@/lib/schema";
import { useStored } from "@/lib/store";
import { Icon, type IconName } from "./icons";

type Result = {
  notice: Notice;
  image: string | null;
  source: "live" | "fixture";
  language: Language;
  model?: string;
};
type Thread = { id: string; original: Result; revised: Result | null };
type Slot = "original" | "revised";
type Tone = "ok" | "warn" | "bad";
type Tint = "blue" | "green" | "amber" | "violet" | "pink";

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

async function extract(image: string, language: Language): Promise<Result> {
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

// Bring the new result into view and move screen-reader focus to it.
function showResult(id: string) {
  setTimeout(() => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ block: "start" });
    el?.focus({ preventScroll: true });
  }, 50);
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
  explain: "Explained by AI",
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
      <button className="proof-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="search" size="1.05em" />
        {open ? "Hide proof" : "Show me where"}
      </button>
      {open && (
        <div className="proof-body">
          {quotes.length === 0 ? (
            <p>The AI gave no passage for this. Please check the photo yourself.</p>
          ) : (
            quotes.map((q, i) => (
              <figure key={i} className="snippet">
                <figcaption>From the notice</figcaption>
                <blockquote lang={notice.originalLanguage === "Kannada" ? "kn" : undefined}>
                  <mark>{q.quote}</mark>
                </blockquote>
              </figure>
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

function ReadAloud({ text, language, light = false }: { text: string; language: Language; light?: boolean }) {
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
      <button className={light ? "on-dark" : "ghost"} onClick={toggle}>
        <Icon name={state === "speaking" ? "stop" : "speaker"} />
        {state === "speaking" ? "Stop reading" : "Read aloud"}
      </button>
      {state === "unavailable" && (
        <p className="muted" role="status">
          This device has no {LANGUAGES[language].name} voice installed.
        </p>
      )}
    </>
  );
}

function Section({
  id,
  title,
  icon,
  tint = "blue",
  className = "",
  children,
}: {
  id: string;
  title: string;
  icon: IconName;
  tint?: Tint;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`card tint-${tint} ${className}`} aria-labelledby={id}>
      <h2 id={id} className="section-title">
        <span className="badge">
          <Icon name={icon} />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Banner({
  tone,
  big = false,
  live = false,
  children,
}: {
  tone: Tone;
  big?: boolean;
  live?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`banner ${tone}${big ? " big" : ""}`} role={live ? "status" : undefined}>
      <span className="banner-icon">
        <Icon name={tone === "ok" ? "check" : tone === "warn" ? "info" : "alert"} />
      </span>
      <div>{children}</div>
    </div>
  );
}

function DateTile({ date, language }: { date: string | null; language: Language }) {
  if (!isIsoDate(date)) {
    return (
      <div className="tile unknown" aria-hidden="true">
        <span className="tile-top">Date</span>
        <span className="tile-day">?</span>
        <span className="tile-bottom">check</span>
      </div>
    );
  }
  const d = new Date(`${date}T00:00:00Z`);
  const part = (o: Intl.DateTimeFormatOptions) =>
    d.toLocaleDateString(LANGUAGES[language].speech, { ...o, timeZone: "UTC" });
  return (
    <div className="tile" aria-hidden="true">
      <span className="tile-top">{part({ month: "short" })}</span>
      <span className="tile-day">{d.getUTCDate()}</span>
      <span className="tile-bottom">{part({ weekday: "short" })}</span>
    </div>
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
          <input type="radio" name={legend} checked={value === v} onChange={() => onChange(v)} />
          {v === "yes" ? "Yes" : v === "no" ? "No" : "Skip"}
        </label>
      ))}
    </fieldset>
  );
}

const OUTCOME_LABEL: Record<Outcome, string> = {
  match: "Matches the stated conditions",
  "no-match": "Doesn't match a stated condition",
  unknown: "Need more information",
};

// A match on a water cut is bad news; a match on a scholarship is good news.
function verdict(n: Notice, outcome: Outcome): { title: string; sub: string; tone: Tone } {
  if (outcome === "unknown") {
    return { title: "Not checked yet", sub: "Add your details below", tone: "warn" };
  }
  if (n.category === "scholarship") {
    return outcome === "match"
      ? { title: "Looks like a match", sub: "Your household meets what is stated", tone: "ok" }
      : { title: "May not match", sub: "A stated condition is not met", tone: "bad" };
  }
  if (n.category === "circular" || n.category === "legal") {
    return outcome === "match"
      ? { title: "This applies to you", sub: "It matches your household details", tone: "warn" }
      : { title: "May not apply to you", sub: "It doesn't match your details", tone: "ok" };
  }
  return outcome === "match"
    ? { title: "This affects you", sub: "It matches your household details", tone: "bad" }
    : { title: "May not affect you", sub: "It doesn't match your details", tone: "ok" };
}

// Circulars and legal papers: the consequences the document states, the laws
// it names, and its official words explained. Nothing here is advice.
function FinePrint({ notice, lang }: { notice: Notice; lang: Language }) {
  const n = notice;
  if (n.consequences.length + n.lawsCited.length + n.keyTerms.length === 0) return null;
  return (
    <Section id="fineprint" title="The fine print, in plain words" icon="info" tint="violet">
      {n.consequences.length > 0 && (
        <>
          <h3>
            If you do not act, the document says <Tag kind="notice" />
          </h3>
          <ul className="plain-list" lang={lang}>
            {n.consequences.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Proof notice={n} fields={["consequences"]} />
        </>
      )}
      {n.keyTerms.length > 0 && (
        <>
          <h3>
            Official words explained <Tag kind="explain" />
          </h3>
          <dl className="terms" lang={lang}>
            {n.keyTerms.map((k) => (
              <div key={k.term}>
                <dt>{k.term}</dt>
                <dd>{k.meaning}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {n.lawsCited.length > 0 && (
        <>
          <h3>
            Laws and rules it names <Tag kind="notice" />
          </h3>
          <ul className="plain-list">
            {n.lawsCited.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <Proof notice={n} fields={["laws"]} />
        </>
      )}
    </Section>
  );
}

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
  const v = verdict(notice, outcome);
  return (
    <Section id="household" title="Does this affect my family?" icon="home" tint="green">
      <Banner tone={v.tone} big live>
        <strong>{OUTCOME_LABEL[outcome]}</strong>
        <br />
        {v.title}. {v.sub}.
      </Banner>
      {checks.length === 0 ? (
        <p>The notice states no areas or conditions that can be checked.</p>
      ) : (
        <ul className="reasons">
          {checks.map((c, i) => (
            <li key={i}>
              <span className={`dot ${c.outcome}`} aria-hidden="true">
                <Icon name={c.outcome === "match" ? "check" : c.outcome === "no-match" ? "close" : "info"} size="0.9em" />
              </span>
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

function CheckList({
  items,
  lang,
  done,
  setDone,
}: {
  items: string[];
  lang: Language;
  done: string[];
  setDone: (d: string[]) => void;
}) {
  return (
    <ul className="checklist" lang={lang}>
      {items.map((item) => (
        <li key={item} className={done.includes(item) ? "done" : ""}>
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

function VisitReadiness({
  notice,
  lang,
  have,
  setHave,
}: {
  notice: Notice;
  lang: Language;
  have: string[];
  setHave: (h: string[]) => void;
}) {
  const offices = findRecords(notice).filter((r) => r.kind === "office");
  const docs = notice.documentsRequired;
  const missing = docs.length - have.length;
  return (
    <Section id="visit" title="Before you leave home" icon="bag" tint="violet">
      {docs.length > 0 && (
        <>
          <h3>
            Documents to carry <Tag kind="notice" />
          </h3>
          <div className="meter-row">
            <div
              className="meter"
              role="progressbar"
              aria-label="Documents collected"
              aria-valuemin={0}
              aria-valuemax={docs.length}
              aria-valuenow={have.length}
            >
              <span style={{ width: `${(have.length / docs.length) * 100}%` }} />
            </div>
            <strong>
              {have.length}/{docs.length}
            </strong>
          </div>
          <CheckList items={docs} lang={lang} done={have} setDone={setHave} />
          <Banner tone={missing === 0 ? "ok" : "warn"} live>
            {missing === 0
              ? "You have ticked every listed document."
              : `${missing} of ${docs.length} documents still to collect.`}
          </Banner>
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
      <Banner tone="warn">
        {offices.some((r) => r.hours)
          ? "Opening hours come from an outside source. Confirm before travelling."
          : "Opening hours unavailable. Confirm before travelling."}
      </Banner>
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
    <Section id="ask" title="Ask about this notice" icon="chat" tint="blue">
      <form onSubmit={ask} className="ask">
        <label className="field">
          <span className="sr">Your question</span>
          <input
            type="text"
            value={question}
            maxLength={300}
            placeholder="e.g. Will tankers be arranged?"
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        <button disabled={busy || !question.trim()}>
          {busy ? "Asking…" : "Ask"}
          {!busy && <Icon name="arrow" />}
        </button>
      </form>
      {error && (
        <div role="alert">
          <Banner tone="bad">{error}</Banner>
        </div>
      )}
      {answer && (
        <div role="status" className="answer-bubble">
          <p lang={language}>{answer}</p>
          <p className="muted">
            Answered by Gemma 4 using only the facts read from the notice. It can be wrong.
          </p>
        </div>
      )}
    </Section>
  );
}

function Photo({ image }: { image: string | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  if (!image) return <p className="muted">This is a synthetic sample, so there is no photo.</p>;
  return (
    <>
      <button className="photo" onClick={() => dialog.current?.showModal()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="The notice you uploaded" />
        <span>
          <Icon name="zoom" /> Tap to enlarge
        </span>
      </button>
      <dialog ref={dialog} className="zoom" aria-label="Enlarged notice photo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="The notice you uploaded, enlarged" />
        <form method="dialog">
          <button>
            <Icon name="close" /> Close
          </button>
        </form>
      </dialog>
    </>
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
  const [doneOfficial, setDoneOfficial] = useState<string[]>([]);
  const [doneSuggested, setDoneSuggested] = useState<string[]>([]);
  const [have, setHave] = useState<string[]>([]);
  const [shared, setShared] = useState(false);

  const confirmed: ConfirmedEvent | null =
    checked && isIsoDate(date)
      ? { date, startTime: isTime(start) ? start : null, endTime: isTime(end) ? end : null }
      : null;
  const saved = reminders.find((r) => r.threadId === thread.id) ?? null;
  const savedIsCurrent = !!saved && saved.date === date && (saved.startTime ?? "") === start;
  const helplines = findRecords(n).filter((r) => r.kind === "helpline");
  const hasVisit = n.documentsRequired.length > 0 || !!n.officeLocation;
  const dateLabel =
    n.dateKind === "deadline" ? "Deadline" : n.dateKind === "effective" ? "In force from" : "When";
  const shownDate = confirmed?.date ?? n.eventDate;
  const whenText = confirmed
    ? formatWhen(confirmed, lang)
    : n.eventDate
      ? formatWhen({ date: n.eventDate, startTime: n.startTime, endTime: n.endTime }, lang)
      : null;
  const { outcome } = checkRelevance(n, profile);
  const v = verdict(n, outcome);
  const where = n.officeLocation
    ? n.officeLocation
    : n.affectedAreas.length
      ? n.affectedAreas.slice(0, 3).join(", ") +
        (n.affectedAreas.length > 3 ? ` and ${n.affectedAreas.length - 3} more` : "")
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
      setShared(true);
      setStatus("Card copied. Paste it into a message to share it.");
    } catch {
      setStatus("Could not copy automatically. Please select the text and copy it.");
    }
  }

  async function shareCard() {
    if (!navigator.share) return copyCard();
    try {
      await navigator.share({ text: cardText });
      setShared(true);
    } catch {}
  }

  const facts: { label: string; value: string | null; fields: string[] }[] = [
    { label: "Issued by", value: n.issuer, fields: ["issuer"] },
    { label: "Addressed to", value: n.addressedTo, fields: [] },
    { label: "Areas", value: n.affectedAreas.join(", ") || null, fields: ["affectedAreas"] },
    { label: "Amount", value: n.amount, fields: ["amount"] },
    { label: "Reference", value: n.referenceNumber, fields: [] },
  ];

  const steps: { id: string; label: string; done: boolean }[] = [
    { id: "answer", label: "Understand", done: true },
    { id: "household", label: "My family", done: outcome !== "unknown" },
    {
      id: "todo",
      label: "To do",
      done: n.requirements.length > 0 && doneOfficial.length === n.requirements.length,
    },
    ...(hasVisit
      ? [
          {
            id: "visit",
            label: "Visit",
            done: n.documentsRequired.length > 0 && have.length === n.documentsRequired.length,
          },
        ]
      : []),
    { id: "reminder", label: "Reminder", done: savedIsCurrent },
    { id: "family", label: "Share", done: shared },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <>
      <nav className="stepper" aria-label="Your plan for this notice">
        <span className="stepper-count">
          {doneCount}/{steps.length}
        </span>
        <ol>
          {steps.map((s, i) => (
            <li key={s.id} className={s.done ? "done" : ""}>
              <a href={`#${s.id}`}>
                <span className="stepper-dot" aria-hidden="true">
                  {s.done ? <Icon name="check" size="0.9em" /> : i + 1}
                </span>
                {s.label}
                <span className="sr">{s.done ? " (done)" : " (to do)"}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="layout reveal">
        <div className="col">
          <section className="verdict" aria-labelledby="answer">
            <div className="verdict-chips">
              <span>{n.documentType ?? "Notice"}</span>
              {n.issuer && <span>{n.issuer}</span>}
            </div>
            <h2 id="answer" lang={lang}>
              {n.headline ?? n.title ?? "Here is what the notice says"}
            </h2>
            <p className="lead" lang={lang}>
              {n.explanation}
            </p>

            <div className="stats">
              <div className="stat">
                <span className="stat-label">{dateLabel}</span>
                <div className="stat-when">
                  <DateTile date={shownDate} language={lang} />
                  <p lang={whenText ? lang : undefined}>
                    {whenText ?? "Not readable. Please check the notice."}
                  </p>
                </div>
                <Tag kind={n.eventDate && n.unresolved.length === 0 ? "notice" : "confirm"} />
              </div>
              <div className="stat">
                <span className="stat-label">{n.officeLocation ? "Where" : "Areas"}</span>
                <p lang={where ? lang : undefined}>{where ?? "Not stated in the notice"}</p>
                {where && <Tag kind="notice" />}
              </div>
              <a className={`stat for-you ${v.tone}`} href="#household">
                <span className="stat-label">For your family</span>
                <p>
                  <strong>{v.title}</strong>
                </p>
                <span className="stat-sub">
                  {v.sub} <Icon name="arrow" size="1em" />
                </span>
              </a>
            </div>

            {n.dateText && <p className="as-written">As written in the notice: {n.dateText}</p>}
            <div className="actions">
              <ReadAloud
                light
                text={[n.headline, n.explanation, ...n.requirements].filter(Boolean).join(". ")}
                language={lang}
              />
            </div>
            <Proof notice={n} fields={["date", "time"]} />
          </section>

          {n.unresolved.length > 0 && (
            <Banner tone="warn" big>
              <strong>Needs your confirmation</strong>
              <ul>
                {n.unresolved.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </Banner>
          )}

          {n.category === "legal" && (
            <Banner tone="warn" big>
              <strong>This is not legal advice.</strong>
              <br />
              It explains what the document says, not whether it is correct or what you should do
              about it. Speak to a lawyer or free legal aid before the deadline. See Helpful
              contacts.
            </Banner>
          )}

          <Household notice={n} profile={profile} setProfile={setProfile} />

          <FinePrint notice={n} lang={lang} />

          <Section id="todo" title="What to do" icon="list" tint="amber">
            {n.requirements.length > 0 ? (
              <>
                <h3>
                  The notice asks you to <Tag kind="notice" />
                </h3>
                <CheckList items={n.requirements} lang={lang} done={doneOfficial} setDone={setDoneOfficial} />
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
                <CheckList items={n.suggestions} lang={lang} done={doneSuggested} setDone={setDoneSuggested} />
              </>
            )}
          </Section>

          {hasVisit && <VisitReadiness notice={n} lang={lang} have={have} setHave={setHave} />}

          <Section id="reminder" title="Set a reminder" icon="calendar" tint="blue">
            {saved && (
              <Banner tone="ok">
                Saved reminder: <strong>{formatWhen(saved)}</strong>
              </Banner>
            )}
            {saved && isIsoDate(date) && !savedIsCurrent && (
              <Banner tone="warn">
                Your saved reminder shows the earlier date. Confirm the new date below to update it.
              </Banner>
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
                <input
                  type="time"
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                    setChecked(false);
                  }}
                />
              </label>
              <label className="field">
                To
                <input
                  type="time"
                  value={end}
                  onChange={(e) => {
                    setEnd(e.target.value);
                    setChecked(false);
                  }}
                />
              </label>
            </div>
            {!isIsoDate(date) && (
              <Banner tone="warn">
                The date could not be read. Type it in from the notice to set a reminder.
              </Banner>
            )}
            <label className={`confirm${checked ? " on" : ""}`}>
              <input
                type="checkbox"
                checked={checked}
                disabled={!isIsoDate(date)}
                onChange={(e) => setChecked(e.target.checked)}
              />
              <span>I have checked this date and time against the notice</span>
            </label>
            <button className="wide" onClick={approve} disabled={!confirmed}>
              <Icon name="calendar" />
              {saved ? "Approve and update reminder" : "Approve and download reminder"}
            </button>
            <p className="muted">The reminder rings 12 hours before.</p>
          </Section>

          <Section id="family" title="Card for my family" icon="card" tint="pink">
            <div className="family-card" lang={lang}>
              <div className="family-head">
                <span>{n.documentType ?? "Notice"}</span>
                <Icon name="share" />
              </div>
              <div className="family-body">
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
                    <ul className="soft">
                      {card.suggested.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="sub foot">
                  {L.source}: {card.source}
                  <br />
                  {L.madeOn}: {card.madeOn}
                  <br />
                  {L.disclaimer}
                </p>
              </div>
            </div>
            <label className={`confirm${hidePersonal ? " on" : ""}`}>
              <input type="checkbox" checked={hidePersonal} onChange={(e) => setHidePersonal(e.target.checked)} />
              <span>Hide names, account numbers and addresses</span>
            </label>
            <p className="muted">Read the card before you share it. Sharing happens only when you press a button.</p>
            <div className="actions">
              <button onClick={shareCard}>
                <Icon name="share" /> Share card
              </button>
              <button className="ghost" onClick={copyCard}>
                <Icon name="copy" /> Copy text
              </button>
              <ReadAloud text={cardText} language={lang} />
            </div>
          </Section>

          <Ask notice={n} language={lang} />
        </div>

        <aside className="side">
          <Section id="proof" title="Proof" icon="search" tint="amber">
            <p className="muted">The facts as read, and your photo to check them against.</p>
            <div id="photo" tabIndex={-1}>
              <Photo image={result.image} />
            </div>
            <ul className="facts">
              {facts
                .filter((f) => f.value)
                .map((f) => (
                  <li key={f.label}>
                    <span className="eyebrow">{f.label}</span>
                    <span>{f.value}</span> <Tag kind="notice" />
                    {f.fields.length > 0 && <Proof notice={n} fields={f.fields} />}
                  </li>
                ))}
            </ul>
          </Section>

          <Section id="external" title="Helpful contacts" icon="phone" tint="violet">
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
          {result.model && <p className="muted center">Read by {result.model}</p>}
        </aside>
      </div>

      {status && (
        <div className="toast" role="status">
          <span className="toast-icon">
            <Icon name="check" />
          </span>
          <p>{status}</p>
          <button className="toast-close" aria-label="Dismiss message" onClick={() => setStatus("")}>
            <Icon name="close" />
          </button>
        </div>
      )}
    </>
  );
}

// Decorative picture of the idea: a notice goes in, three answers come out.
function HeroArt() {
  return (
    <div className="document-art" aria-hidden="true">
      <div className="document-back" />
      <div className="document-sheet">
        <div className="document-top"><Icon name="list" /><span>PUBLIC NOTICE</span><span>01</span></div>
        <p className="document-kannada">ಸಾರ್ವಜನಿಕ ಪ್ರಕಟಣೆ</p>
        <div className="document-rule" />
        <span className="document-line" /><span className="document-line short" />
        <span className="document-highlight">What matters. Made clear.</span>
        <span className="document-line" /><span className="document-line short" />
      </div>
      <span className="document-stamp"><Icon name="check" size="1em" /> A little clarity</span>
    </div>
  );
}

const FEATURES: { icon: IconName; tint: Tint; title: string; text: string }[] = [
  { icon: "search", tint: "amber", title: "See the source.", text: "Check important details against the words in your notice." },
  { icon: "home", tint: "green", title: "Make it personal.", text: "Find out what the notice means for your area and household." },
  { icon: "refresh", tint: "blue", title: "Keep up with changes.", text: "Compare a revised notice before updating your plan." },
  { icon: "card", tint: "pink", title: "Bring everyone along.", text: "A simple summary to share with family, in their language." },
];

export default function Home() {
  const [language, setLanguage] = useStored<Language>("nta.language", "en");
  const [scale, setScale] = useStored<number>("nta.scale", 1);
  const [profile, setProfile] = useStored<Profile>("nta.profile", EMPTY_PROFILE);
  const [reminders, setReminders] = useStored<SavedReminder[]>("nta.reminders", NO_REMINDERS);
  const [thread, setThread] = useState<Thread | null>(null);
  const [pending, setPending] = useState<{ slot: Slot; image: string | null } | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const busy = pending !== null;

  async function onFile(file: File | undefined, slot: Slot) {
    if (!file || busy) return;
    setError("");
    if (!file.type.startsWith("image/")) {
      setError("Please choose a photo of the notice.");
      return;
    }
    setPending({ slot, image: null });
    try {
      const image = await toDataUrl(file);
      setPending({ slot, image });
      const result = await extract(image, language);
      if (slot === "revised" && thread) setThread({ ...thread, revised: result });
      else setThread({ id: crypto.randomUUID(), original: result, revised: null });
      showResult("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setPending(null);
    }
  }

  function loadFixture(notice: Notice) {
    setError("");
    setThread({
      id: crypto.randomUUID(),
      original: { notice, image: null, source: "fixture", language: "en" },
      revised: null,
    });
    showResult("result");
  }

  const current = thread ? (thread.revised ?? thread.original) : null;
  const changes = thread?.revised ? compareNotices(thread.original.notice, thread.revised.notice) : null;
  const updates = changes ? planUpdates(changes) : [];
  const fixture = current?.source === "fixture";

  const picker = (slot: Slot, capture: boolean, label: string, cls = "") => (
    <label className={`file ${cls}`}>
      <Icon name={capture ? "camera" : "image"} />
      {label}
      <input
        type="file"
        accept="image/*"
        capture={capture ? "environment" : undefined}
        disabled={busy}
        onChange={(e) => {
          onFile(e.target.files?.[0], slot);
          e.target.value = "";
        }}
      />
    </label>
  );

  const scanning = pending && (
    <div className="scan" role="status">
      <div className="scan-frame">
        {pending.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pending.image} alt="" />
        ) : (
          <div className="scan-blank" />
        )}
        <div className="beam" aria-hidden="true" />
      </div>
      <div>
        <p className="scan-title">Gemma 4 is reading your notice…</p>
        <p className="muted">This can take up to a minute. Please keep this page open.</p>
      </div>
    </div>
  );

  return (
    <div className="app" style={{ "--scale": scale } as CSSProperties}>
      <a className="skip" href="#start">
        Skip to upload
      </a>
      <header className="topbar">
        <div className="topbar-in">
          {/* A full page load on purpose: it clears the notice on screen. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="brand" href="/" aria-label="Notice to Action home">
            <span className="mark" aria-hidden="true">
              <Icon name="arrow" />
            </span>
            <span>
              Notice<span className="brand-arrow"> → </span>Action
            </span>
          </a>
          <nav className="header-nav" aria-label="Main navigation">
            <a href={thread ? "#result" : "#how-it-works"}>{thread ? "Your notice" : "How it works"}</a>
            <span className="local-label">Made for everyday India</span>
          </nav>
          <div className="controls">
            <div role="group" aria-label="Text size" className="sizes">
              {SCALES.map((s) => (
                <button
                  key={s.value}
                  className={scale === s.value ? "on" : ""}
                  aria-pressed={scale === s.value}
                  aria-label={s.name}
                  onClick={() => setScale(s.value)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <label className="lang">
              <span className="sr">Explain in</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
                {(Object.keys(LANGUAGES) as Language[]).map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGES[l].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </header>

      <main>
        {!thread ? (
          <>
            <section
              id="start"
              className={`hero${dragging ? " dragging" : ""}`}
              aria-labelledby="hero-title"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                onFile(e.dataTransfer.files?.[0], "original");
              }}
            >
              <div className="hero-text">
                <p className="editorial-kicker"><span /> A little clarity. A lot less worry.</p>
                <h1 id="hero-title">
                  A notice arrives.<br /><em>Know what’s next.</em>
                </h1>
                <p className="hero-sub">
                  From water cuts to scholarship forms, turn official words into simple next steps. For you, and the people you look after.
                </p>
                <div className="language-note"><span>ಕನ್ನಡ</span><span>हिन्दी</span><span>English</span><i>In a language that feels like home.</i></div>
                <div className="hero-caption"><span className="caption-line" /><p>One photo. The details that matter.<br />You decide what happens next.</p></div>
              </div>
              <div className="upload-studio">
                <div className="studio-top"><span>START WITH YOUR NOTICE</span><span>01 / 03</span></div>
                <HeroArt />
                <h2>Let’s make sense of it.</h2>
                <p className="upload-description">Drop a photo here, or choose one below.</p>
                {scanning || (
                  <>
                    <div className="actions cta">
                      {picker("original", false, "Upload a notice", "primary")}
                      {picker("original", true, "Use camera", "ghost")}
                    </div>
                    <div className="samples">
                      <span>Just looking? Try an example</span>
                      <button className="chip-btn" onClick={() => loadFixture(FIXTURE_WATER)}>
                        Water cut
                      </button>
                      <button className="chip-btn" onClick={() => loadFixture(FIXTURE_SCHOLARSHIP)}>
                        Scholarship
                      </button>
                      <button className="chip-btn" onClick={() => loadFixture(FIXTURE_CIRCULAR)}>
                        Govt circular
                      </button>
                      <button className="chip-btn" onClick={() => loadFixture(FIXTURE_LEGAL)}>
                        Legal notice
                      </button>
                    </div>
                  </>
                )}
                <p className="upload-footnote"><Icon name="info" size="1em" /> Images are processed online. Use non-sensitive notices.</p>
              </div>
            </section>

            {error && (
              <div role="alert">
                <Banner tone="bad">{error}</Banner>
              </div>
            )}

            <div id="how-it-works" className="section-intro"><p>FROM INFORMATION TO A LITTLE PEACE OF MIND</p><span>More than a translation.</span></div>
            <section className="features" aria-label="What you get">
              {FEATURES.map((f, i) => (
                <div key={f.title} className={`feature tint-${f.tint}`}>
                  <div className="feature-top"><span className="feature-number">0{i + 1}</span><span className="badge">
                    <Icon name={f.icon} />
                  </span></div>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </div>
              ))}
            </section>

            <p className="privacy">
              <Icon name="info" /> Your photo is sent to a hosted AI service (Gemma 4 through
              OpenRouter) to be read, so do not upload private documents. Your household details and
              reminders stay in this browser. This is not an official government service.
            </p>
          </>
        ) : (
          <>
            <section id="start" className="again" aria-label="Read another notice">
              {scanning && pending?.slot === "original" ? (
                scanning
              ) : (
                <>
                  <strong>Read another notice</strong>
                  <div className="actions">
                    {picker("original", true, "Take a photo", "small")}
                    {picker("original", false, "Choose a photo", "ghost small")}
                  </div>
                </>
              )}
            </section>
            {error && (
              <div role="alert">
                <Banner tone="bad">{error}</Banner>
              </div>
            )}
          </>
        )}

        {thread && current && (
          <>
            <div id="result" tabIndex={-1} className="result-anchor" />
            {fixture && (
              <Banner tone="bad">
                <strong>Sample.</strong> This is a hand-written synthetic notice. It is not AI output
                and not a real notice.
              </Banner>
            )}

            {changes && (
              <Section id="changed" title="What changed?" icon="refresh" tint="amber" className="changed">
                {changes.length === 0 ? (
                  <p>Nothing important changed: the date, time, areas, office and documents are the same.</p>
                ) : (
                  <>
                    <ul className="diff">
                      {changes.map((c) => (
                        <li key={c.field}>
                          <span className="eyebrow">{c.label}</span>
                          <div className="diff-row">
                            <div className="diff-before">
                              <span className="sr">Before: </span>
                              {c.before}
                            </div>
                            <span className="diff-arrow" aria-hidden="true">
                              <Icon name="arrow" />
                            </span>
                            <div className="diff-after">
                              <span className="sr">Now: </span>
                              {c.after}
                            </div>
                          </div>
                          <p className="diff-sentence">{c.sentence}</p>
                          <Proof notice={current.notice} fields={[c.field]} />
                        </li>
                      ))}
                    </ul>
                    {updates.length > 0 && (
                      <Banner tone="warn" big live>
                        <strong>
                          Your plan needs {updates.length} update{updates.length === 1 ? "" : "s"}
                        </strong>
                        <br />
                        Check {updates.join(" and ")}.
                      </Banner>
                    )}
                  </>
                )}
                <p className="muted">Everything below now shows the newer notice.</p>
              </Section>
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

            <section className="card revise" aria-labelledby="revise">
              <h2 id="revise" className="section-title">
                <span className="badge">
                  <Icon name="refresh" />
                </span>
                Got a corrected notice later?
              </h2>
              <p>
                Add the newer notice here only if it replaces the one above. We will show what
                changed and help you update your reminder.
              </p>
              {scanning && pending?.slot === "revised" ? (
                scanning
              ) : (
                <div className="actions">
                  {picker("revised", true, "Photo of the new notice")}
                  {picker("revised", false, "Choose a photo", "ghost")}
                  {thread.original.notice === FIXTURE_WATER && !thread.revised && (
                    <button
                      className="ghost"
                      onClick={() => {
                        setThread({
                          ...thread,
                          revised: { notice: FIXTURE_WATER_REVISED, image: null, source: "fixture", language: "en" },
                        });
                        showResult("result");
                      }}
                    >
                      Sample corrected notice
                    </button>
                  )}
                </div>
              )}
            </section>
          </>
        )}

        {reminders.length > 0 && (
          <Section id="saved" title="My saved reminders" icon="calendar" tint="green">
            <ul className="saved">
              {reminders.map((r) => (
                <li key={r.threadId}>
                  <DateTile date={r.date} language="en" />
                  <div>
                    <strong>{r.title}</strong>
                    <br />
                    {formatWhen(r)}
                    {r.sequence > 0 && <span className="muted"> (updated {r.sequence}×)</span>}
                  </div>
                  <button
                    className="ghost small"
                    aria-label={`Remove reminder for ${r.title}`}
                    onClick={() => setReminders(reminders.filter((x) => x.threadId !== r.threadId))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <p className="muted">Kept only in this browser. Removing one here does not change your calendar.</p>
          </Section>
        )}
      </main>

      <footer>
        <div className="footer-wordmark">A little less confusion.<br /><em>A little more everyday confidence.</em></div>
        <div className="footer-badges">
          <span>Gemma 4 · open-weight model</span>
          <span>Open source · MIT</span>
          <span>Hacktoberfest Hack Day Bengaluru ’26</span>
        </div>
        <p>
          The AI can make mistakes, so always check the original notice. Not an official government
          service.
        </p>
      </footer>
    </div>
  );
}
