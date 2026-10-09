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
import { CARD_LABELS, translator } from "@/lib/i18n";
import { LANGUAGES, isIsoDate, isTime, type Language, type Notice } from "@/lib/schema";
import { useStored } from "@/lib/store";
import {
  AccountBar,
  AskBox,
  MyNotices,
  Related,
  SaveCard,
  useSession,
  type SavedDocument,
} from "./account";
import { Icon, type IconName } from "./icons";
import { LangContext, useT } from "./lang";

// A marked region of the photo, in percentages of its width and height.
type Box = { label: string; top: number; left: number; height: number; width: number };

type Result = {
  notice: Notice;
  image: string | null;
  source: "live" | "fixture" | "saved";
  language: Language;
  model?: string;
  // Undefined while the highlights are still being found.
  boxes?: Box[];
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

// Enlarged top and bottom halves of the same photo, overlapping in the middle.
// The model sees every image at a fixed, low resolution, so these let it read
// small print that is lost in the full-page view.
async function toTiles(file: File): Promise<string[]> {
  const bitmap = await createImageBitmap(file);
  if (bitmap.height < 900) return [];
  const height = Math.round(bitmap.height * 0.56);
  return [0, bitmap.height - height].map((top) => {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(height * scale);
    canvas
      .getContext("2d")!
      .drawImage(bitmap, 0, top, bitmap.width, height, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
  });
}

async function extract(image: string, tiles: string[], language: Language): Promise<Result> {
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image, tiles, language }),
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
  const t = useT();
  return <span className={`tag ${kind}`}>{t(TAGS[kind])}</span>;
}

// "Show me where": the passages the model says support a fact, plus a jump to the photo.
function Proof({ notice, fields }: { notice: Notice; fields: string[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const quotes = notice.evidence.filter((e) => fields.includes(e.field));
  return (
    <div className="proof">
      <button className="proof-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="search" size="1.05em" />
        {t(open ? "Hide proof" : "Show me where")}
      </button>
      {open && (
        <div className="proof-body">
          {quotes.length === 0 ? (
            <p>{t("The AI gave no passage for this. Please check the photo yourself.")}</p>
          ) : (
            quotes.map((q, i) => (
              <figure key={i} className="snippet">
                <figcaption>{t("From the notice")}</figcaption>
                <blockquote lang={notice.originalLanguage === "Kannada" ? "kn" : undefined}>
                  <mark>{q.quote}</mark>
                </blockquote>
              </figure>
            ))
          )}
          <p className="muted">
            {t("This is the AI's reading of the notice.")} <a href="#photo">{t("Compare with the photo")}</a>
          </p>
        </div>
      )}
    </div>
  );
}

function ReadAloud({ text, language, light = false }: { text: string; language: Language; light?: boolean }) {
  const t = useT();
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
        {t(state === "speaking" ? "Stop reading" : "Read aloud")}
      </button>
      {state === "unavailable" && (
        <p className="muted" role="status">
          {t("This device has no {lang} voice installed.", { lang: LANGUAGES[language].name })}
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
  const t = useT();
  if (!isIsoDate(date)) {
    return (
      <div className="tile unknown" aria-hidden="true">
        <span className="tile-top">{t("Date")}</span>
        <span className="tile-day">?</span>
        <span className="tile-bottom">{t("check")}</span>
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
  const t = useT();
  return (
    <fieldset className="choice">
      <legend>{legend}</legend>
      {(["yes", "no", ""] as YesNo[]).map((v) => (
        <label key={v || "skip"} className={value === v ? "on" : ""}>
          <input type="radio" name={legend} checked={value === v} onChange={() => onChange(v)} />
          {t(v === "yes" ? "Yes" : v === "no" ? "No" : "Skip")}
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
  const t = useT();
  const n = notice;
  if (n.consequences.length + n.lawsCited.length + n.keyTerms.length === 0) return null;
  return (
    <Section id="fineprint" title={t("The fine print, in plain words")} icon="info" tint="violet">
      {n.consequences.length > 0 && (
        <>
          <h3>
            {t("If you do not act, the document says")} <Tag kind="notice" />
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
            {t("Official words explained")} <Tag kind="explain" />
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
            {t("Laws and rules it names")} <Tag kind="notice" />
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
  const t = useT();
  const { outcome, checks } = checkRelevance(notice, profile, t);
  const v = verdict(notice, outcome);
  return (
    <Section id="household" title={t("Does this affect my family?")} icon="home" tint="green">
      <Banner tone={v.tone} big live>
        <strong>{t(OUTCOME_LABEL[outcome])}</strong>
        <br />
        {t(v.title)}. {t(v.sub)}.
      </Banner>
      {checks.length === 0 ? (
        <p>{t("The notice states no areas or conditions that can be checked.")}</p>
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
        {t("This is a simple comparison, not a final decision on eligibility. Confirm with the issuer.")}
      </p>
      <details open={!profile.locality}>
        <summary>{t("My household details")}</summary>
        <p className="muted">
          {t("Optional. Kept only in this browser and never sent to the AI. No ID numbers are needed.")}
        </p>
        <label className="field">
          {t("Locality or area name")}
          <input
            type="text"
            value={profile.locality}
            autoComplete="address-level3"
            placeholder={t("e.g. Mathikere")}
            onChange={(e) => setProfile({ ...profile, locality: e.target.value })}
          />
        </label>
        <label className="field">
          {t("Water provider")}
          <select
            value={profile.provider}
            onChange={(e) => setProfile({ ...profile, provider: e.target.value as Profile["provider"] })}
          >
            <option value="">{t("Not sure")}</option>
            <option value="bwssb">{t("BWSSB (Cauvery water)")}</option>
            <option value="other">{t("Another provider, borewell or tanker")}</option>
          </select>
        </label>
        <Choice
          legend={t("Is there a student in the household?")}
          value={profile.student}
          onChange={(student) => setProfile({ ...profile, student })}
        />
        <Choice
          legend={t("Is there a senior citizen in the household?")}
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
  const t = useT();
  const offices = findRecords(notice).filter((r) => r.kind === "office");
  const docs = notice.documentsRequired;
  const missing = docs.length - have.length;
  return (
    <Section id="visit" title={t("Before you leave home")} icon="bag" tint="violet">
      {docs.length > 0 && (
        <>
          <h3>
            {t("Documents to carry")} <Tag kind="notice" />
          </h3>
          <div className="meter-row">
            <div
              className="meter"
              role="progressbar"
              aria-label={t("Documents collected")}
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
              ? t("You have ticked every listed document.")
              : t("{m} of {n} documents still to collect.", { m: missing, n: docs.length })}
          </Banner>
          <Proof notice={notice} fields={["documents"]} />
        </>
      )}
      <h3>{t("Where to go")}</h3>
      {notice.officeLocation ? (
        <>
          <p lang={lang}>
            {notice.officeLocation} <Tag kind="notice" />
          </p>
          <Proof notice={notice} fields={["office"]} />
        </>
      ) : (
        <p>{t("The notice does not name an office.")}</p>
      )}
      {offices.map((r) => (
        <div key={r.service} className="external">
          <p>
            <strong>{r.service}</strong> <Tag kind="external" />
            <br />
            {r.detail}
          </p>
          <p className="muted">
            {r.matchRule} <a href={r.sourceUrl} target="_blank" rel="noreferrer">{t("Source")}</a>, {t("retrieved {d}", { d: r.retrieved })}.
          </p>
        </div>
      ))}
      <Banner tone="warn">
        {offices.some((r) => r.hours)
          ? t("Opening hours come from an outside source. Confirm before travelling.")
          : t("Opening hours unavailable. Confirm before travelling.")}
      </Banner>
    </Section>
  );
}

function Ask({ notice, language }: { notice: Notice; language: Language }) {
  const t = useT();
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
    <Section id="ask" title={t("Ask about this notice")} icon="chat" tint="blue">
      <form onSubmit={ask} className="ask">
        <label className="field">
          <span className="sr">{t("Your question")}</span>
          <input
            type="text"
            value={question}
            maxLength={300}
            placeholder={t("e.g. Will tankers be arranged?")}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        <button disabled={busy || !question.trim()}>
          {t(busy ? "Asking…" : "Ask")}
          {!busy && <Icon name="arrow" />}
        </button>
      </form>
      {error && (
        <div role="alert">
          <Banner tone="bad">{t(error)}</Banner>
        </div>
      )}
      {answer && (
        <div role="status" className="answer-bubble">
          <p lang={language}>{answer}</p>
          <p className="muted">
            {t("Answered by Gemma 4 using only the facts read from the notice. It can be wrong.")}
          </p>
        </div>
      )}
    </Section>
  );
}

const BOX_NAMES: Record<string, string> = {
  date: "Date",
  time: "Time",
  areas: "Areas",
  amount: "Amount",
  office: "Office",
  documents: "Documents",
  action: "What to do",
  consequence: "If you do not act",
  reference: "Reference",
};

// The photo with the important parts marked where the model found them.
function Marked({ image, boxes, alt, labels }: { image: string; boxes: Box[]; alt: string; labels: boolean }) {
  const t = useT();
  return (
    <span className="photo-frame">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} alt={alt} />
      {boxes.map((b, i) => (
        <span
          key={i}
          className={`mark-box mark-${b.label}`}
          style={{ top: `${b.top}%`, left: `${b.left}%`, height: `${b.height}%`, width: `${b.width}%` }}
        >
          {labels && <b>{t(BOX_NAMES[b.label] ?? b.label)}</b>}
        </span>
      ))}
    </span>
  );
}

function Photo({ result }: { result: Result }) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [show, setShow] = useState(true);
  const image = result.image;
  if (!image) {
    return (
      <p className="muted">
        {t(
          result.source === "saved"
            ? "Photos are not stored, so a saved notice has no photo."
            : "This is a synthetic sample, so there is no photo.",
        )}
      </p>
    );
  }
  const boxes = show ? (result.boxes ?? []) : [];
  const found = result.boxes ?? [];
  return (
    <>
      <button className="photo" onClick={() => dialog.current?.showModal()}>
        <Marked image={image} boxes={boxes} alt={t("The notice you uploaded")} labels={false} />
        <span>
          <Icon name="zoom" /> {t("Tap to enlarge")}
        </span>
      </button>
      {result.boxes === undefined && result.source === "live" && (
        <p className="muted" role="status">
          {t("Finding the important parts on the photo…")}
        </p>
      )}
      {found.length > 0 && (
        <>
          <ul className="legend">
            {[...new Set(found.map((b) => b.label))].map((label) => (
              <li key={label} className={`mark-${label}`}>
                {t(BOX_NAMES[label] ?? label)}
              </li>
            ))}
          </ul>
          <p className="muted">
            {t("Important parts are marked on the photo by the AI. Positions are approximate.")}
          </p>
          <button className="ghost small" onClick={() => setShow(!show)}>
            {t(show ? "Hide highlights" : "Show highlights")}
          </button>
        </>
      )}
      <dialog ref={dialog} className="zoom" aria-label={t("Enlarged notice photo")}>
        <Marked image={image} boxes={boxes} alt={t("The notice you uploaded")} labels />
        <form method="dialog">
          <button>
            <Icon name="close" /> {t("Close")}
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
  const t = useT();
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
  const dateLabel = t(
    n.dateKind === "deadline" ? "Deadline" : n.dateKind === "effective" ? "In force from" : "When",
  );
  const shownDate = confirmed?.date ?? n.eventDate;
  const whenText = confirmed
    ? formatWhen(confirmed, lang)
    : n.eventDate
      ? formatWhen({ date: n.eventDate, startTime: n.startTime, endTime: n.endTime }, lang)
      : null;
  const { outcome } = checkRelevance(n, profile, t);
  const v = verdict(n, outcome);
  const where = n.officeLocation
    ? n.officeLocation
    : n.affectedAreas.length
      ? n.affectedAreas.slice(0, 3).join(", ") +
        (n.affectedAreas.length > 3 ? ` ${t("and {n} more", { n: n.affectedAreas.length - 3 })}` : "")
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
        ? t("Reminder saved and calendar file downloaded. Open the file to add it to your calendar.")
        : out.status === "updated"
          ? t(
              "Reminder updated from {a} to {b}. No second reminder was created. Open the downloaded file to update your calendar.",
              { a: formatWhen(out.previous!, lang), b: formatWhen(confirmed, lang) },
            )
          : t("This reminder was already saved, so nothing new was added. The calendar file was downloaded again."),
    );
  }

  async function copyCard() {
    try {
      await navigator.clipboard.writeText(cardText);
      setShared(true);
      setStatus(t("Card copied. Paste it into a message to share it."));
    } catch {
      setStatus(t("Could not copy automatically. Please select the text and copy it."));
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
      <nav className="stepper" aria-label={t("Your plan for this notice")}>
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
                {t(s.label)}
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
              <span>{n.documentType ?? t("Notice")}</span>
              {n.issuer && <span>{n.issuer}</span>}
            </div>
            <h2 id="answer" lang={lang}>
              {n.headline ?? n.title ?? t("Here is what the notice says")}
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
                    {whenText ?? t("Not readable. Please check the notice.")}
                  </p>
                </div>
                <Tag kind={n.eventDate && n.unresolved.length === 0 ? "notice" : "confirm"} />
              </div>
              <div className="stat">
                <span className="stat-label">{t(n.officeLocation ? "Where" : "Areas")}</span>
                <p lang={where ? lang : undefined}>{where ?? t("Not stated in the notice")}</p>
                {where && <Tag kind="notice" />}
              </div>
              <a className={`stat for-you ${v.tone}`} href="#household">
                <span className="stat-label">{t("For your family")}</span>
                <p>
                  <strong>{t(v.title)}</strong>
                </p>
                <span className="stat-sub">
                  {t(v.sub)} <Icon name="arrow" size="1em" />
                </span>
              </a>
            </div>

            {n.dateText && <p className="as-written">{t("As written in the notice: {x}", { x: n.dateText })}</p>}
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
              <strong>{t("Needs your confirmation")}</strong>
              <ul>
                {n.unresolved.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </Banner>
          )}

          {n.category === "legal" && (
            <Banner tone="warn" big>
              <strong>{t("This is not legal advice.")}</strong>
              <br />
              {t("It explains what the document says, not whether it is correct or what you should do about it. Speak to a lawyer or free legal aid before the deadline. See Helpful contacts.")}
            </Banner>
          )}

          <Household notice={n} profile={profile} setProfile={setProfile} />

          <FinePrint notice={n} lang={lang} />

          <Section id="todo" title={t("What to do")} icon="list" tint="amber">
            {n.requirements.length > 0 ? (
              <>
                <h3>
                  {t("The notice asks you to")} <Tag kind="notice" />
                </h3>
                <CheckList items={n.requirements} lang={lang} done={doneOfficial} setDone={setDoneOfficial} />
                <Proof notice={n} fields={["requirements"]} />
              </>
            ) : (
              <p>{t("The notice does not ask you to do anything specific.")}</p>
            )}
            {n.suggestions.length > 0 && (
              <>
                <h3>
                  {t("You may also want to")} <Tag kind="ai" />
                </h3>
                <CheckList items={n.suggestions} lang={lang} done={doneSuggested} setDone={setDoneSuggested} />
              </>
            )}
          </Section>

          {hasVisit && <VisitReadiness notice={n} lang={lang} have={have} setHave={setHave} />}

          <Section id="reminder" title={t("Set a reminder")} icon="calendar" tint="blue">
            {saved && (
              <Banner tone="ok">
                {t("Saved reminder:")} <strong>{formatWhen(saved, lang)}</strong>
              </Banner>
            )}
            {saved && isIsoDate(date) && !savedIsCurrent && (
              <Banner tone="warn">
                {t("Your saved reminder shows the earlier date. Confirm the new date below to update it.")}
              </Banner>
            )}
            <p>{t("Check the date against the notice, then approve. Nothing is saved before you approve.")}</p>
            <div className="fields">
              <label className="field">
                {t("Date")}
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
                {t("From")}
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
                {t("To")}
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
                {t("The date could not be read. Type it in from the notice to set a reminder.")}
              </Banner>
            )}
            <label className={`confirm${checked ? " on" : ""}`}>
              <input
                type="checkbox"
                checked={checked}
                disabled={!isIsoDate(date)}
                onChange={(e) => setChecked(e.target.checked)}
              />
              <span>{t("I have checked this date and time against the notice")}</span>
            </label>
            <button className="wide" onClick={approve} disabled={!confirmed}>
              <Icon name="calendar" />
              {saved ? t("Approve and update reminder") : t("Approve and download reminder")}
            </button>
            <p className="muted">{t("The reminder rings 12 hours before.")}</p>
          </Section>

          <Section id="family" title={t("Card for my family")} icon="card" tint="pink">
            <div className="family-card" lang={lang}>
              <div className="family-head">
                <span>{n.documentType ?? t("Notice")}</span>
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
              <span>{t("Hide names, account numbers and addresses")}</span>
            </label>
            <p className="muted">{t("Read the card before you share it. Sharing happens only when you press a button.")}</p>
            <div className="actions">
              <button onClick={shareCard}>
                <Icon name="share" /> {t("Share card")}
              </button>
              <button className="ghost" onClick={copyCard}>
                <Icon name="copy" /> {t("Copy text")}
              </button>
              <ReadAloud text={cardText} language={lang} />
            </div>
          </Section>

          <Ask notice={n} language={lang} />
        </div>

        <aside className="side">
          <Section id="proof" title={t("Proof")} icon="search" tint="amber">
            <p className="muted">{t("The facts as read, and your photo to check them against.")}</p>
            <div id="photo" tabIndex={-1}>
              <Photo result={result} />
            </div>
            <ul className="facts">
              {facts
                .filter((f) => f.value)
                .map((f) => (
                  <li key={f.label}>
                    <span className="eyebrow">{t(f.label)}</span>
                    <span>{f.value}</span> <Tag kind="notice" />
                    {f.fields.length > 0 && <Proof notice={n} fields={f.fields} />}
                  </li>
                ))}
            </ul>
          </Section>

          <Section id="external" title={t("Helpful contacts")} icon="phone" tint="violet">
            {helplines.length === 0 && <p>{t("No matching public record was found for this notice.")}</p>}
            {helplines.map((r) => (
              <div key={r.service} className="external">
                <p>
                  <strong>{r.service}</strong> <Tag kind="external" />
                  <br />
                  {r.detail}
                </p>
                <p className="muted">
                  {t("Shown because:")} {r.matchRule}{" "}
                  <a href={r.sourceUrl} target="_blank" rel="noreferrer">{t("Source")}</a>, {t("retrieved {d}", { d: r.retrieved })}.
                </p>
              </div>
            ))}
          </Section>
          {result.model && <p className="muted center">{t("Read by {m}", { m: result.model })}</p>}
        </aside>
      </div>

      {status && (
        <div className="toast" role="status">
          <span className="toast-icon">
            <Icon name="check" />
          </span>
          <p>{status}</p>
          <button className="toast-close" aria-label={t("Dismiss message")} onClick={() => setStatus("")}>
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
  const t = translator(language);
  const { user, refresh } = useSession();
  // Bumped whenever the saved notices change, so the lists reload.
  const [saves, setSaves] = useState(0);

  // Adds the highlight boxes to whichever result shows this photo.
  function attachBoxes(image: string, boxes: Box[]) {
    const mark = (r: Result | null) => (r && r.image === image ? { ...r, boxes } : r);
    setThread((th) => th && { ...th, original: mark(th.original)!, revised: mark(th.revised) });
  }

  function openSaved(d: SavedDocument) {
    setError("");
    setThread({
      id: `saved-${d.id}`,
      original: { notice: d.notice, image: null, source: "saved", language: d.language },
      revised: null,
    });
    showResult("result");
  }

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
      const result = await extract(image, await toTiles(file), language);
      if (slot === "revised" && thread) setThread({ ...thread, revised: result });
      else setThread({ id: crypto.randomUUID(), original: result, revised: null });
      showResult("result");
      // Highlights arrive a few seconds later and do not hold up the answer.
      fetch("/api/highlight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      })
        .then((res) => res.json())
        .then((body) => attachBoxes(image, Array.isArray(body?.boxes) ? body.boxes : []))
        .catch(() => attachBoxes(image, []));
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
  const changes = thread?.revised ? compareNotices(thread.original.notice, thread.revised.notice, t, language) : null;
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
        <p className="scan-title">{t("Gemma 4 is reading your notice…")}</p>
        <p className="muted">{t("This can take up to a minute. Please keep this page open.")}</p>
      </div>
    </div>
  );

  return (
    <LangContext.Provider value={language}>
    <div className="app" lang={language} style={{ "--scale": scale } as CSSProperties}>
      <a className="skip" href="#start">
        {t("Skip to upload")}
      </a>
      <header className="topbar">
        <div className="topbar-in">
          {/* A full page load on purpose: it clears the notice on screen. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="brand" href="/" aria-label={t("Notice to Action home")}>
            <span className="mark" aria-hidden="true">
              <Icon name="arrow" />
            </span>
            <span>
              Notice<span className="brand-arrow"> → </span>Action
            </span>
          </a>
          <nav className="header-nav" aria-label={t("Main navigation")}>
            <a href={thread ? "#result" : "#how-it-works"}>{thread ? t("Your notice") : t("How it works")}</a>
            <span className="local-label">{t("Made for everyday India")}</span>
          </nav>
          <div className="controls">
            <AccountBar user={user} onChange={refresh} />
            <div role="group" aria-label={t("Text size")} className="sizes">
              {SCALES.map((s) => (
                <button
                  key={s.value}
                  className={scale === s.value ? "on" : ""}
                  aria-pressed={scale === s.value}
                  aria-label={t(s.name)}
                  onClick={() => setScale(s.value)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <label className="lang">
              <span className="sr">{t("Explain in")}</span>
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
                <p className="editorial-kicker"><span /> {t("A little clarity. A lot less worry.")}</p>
                <h1 id="hero-title">
                  {t("A notice arrives.")}<br /><em>{t("Know what’s next.")}</em>
                </h1>
                <p className="hero-sub">
                  {t("From water cuts to scholarship forms, turn official words into simple next steps. For you, and the people you look after.")}
                </p>
                <div className="language-note"><span>ಕನ್ನಡ</span><span>हिन्दी</span><span>English</span><i>{t("In a language that feels like home.")}</i></div>
                <div className="hero-caption"><span className="caption-line" /><p>{t("One photo. The details that matter.")}<br />{t("You decide what happens next.")}</p></div>
              </div>
              <div className="upload-studio">
                <div className="studio-top"><span>{t("START WITH YOUR NOTICE")}</span><span>01 / 03</span></div>
                <HeroArt />
                <h2>{t("Let’s make sense of it.")}</h2>
                <p className="upload-description">{t("Drop a photo here, or choose one below.")}</p>
                {scanning || (
                  <>
                    <div className="actions cta">
                      {picker("original", false, t("Upload a notice"), "primary")}
                      {picker("original", true, t("Use camera"), "ghost")}
                    </div>
                    <div className="samples">
                      <span>{t("Just looking? Try an example")}</span>
                      <button className="chip-btn" onClick={() => loadFixture(FIXTURE_WATER)}>
                        {t("Water cut")}
                      </button>
                      <button className="chip-btn" onClick={() => loadFixture(FIXTURE_SCHOLARSHIP)}>
                        {t("Scholarship")}
                      </button>
                      <button className="chip-btn" onClick={() => loadFixture(FIXTURE_CIRCULAR)}>
                        {t("Govt circular")}
                      </button>
                      <button className="chip-btn" onClick={() => loadFixture(FIXTURE_LEGAL)}>
                        {t("Legal notice")}
                      </button>
                    </div>
                  </>
                )}
                <p className="upload-footnote"><Icon name="info" size="1em" /> {t("Images are processed online. Use non-sensitive notices.")}</p>
              </div>
            </section>

            {error && (
              <div role="alert">
                <Banner tone="bad">{t(error)}</Banner>
              </div>
            )}

            <div id="how-it-works" className="section-intro"><p>{t("FROM INFORMATION TO A LITTLE PEACE OF MIND")}</p><span>{t("More than a translation.")}</span></div>
            <section className="features" aria-label={t("What you get")}>
              {FEATURES.map((f, i) => (
                <div key={f.title} className={`feature tint-${f.tint}`}>
                  <div className="feature-top"><span className="feature-number">0{i + 1}</span><span className="badge">
                    <Icon name={f.icon} />
                  </span></div>
                  <h3>{t(f.title)}</h3>
                  <p>{t(f.text)}</p>
                </div>
              ))}
            </section>

            <p className="privacy">
              <Icon name="info" /> {t("Your photo is sent to a hosted AI service (Gemma 4) to be read, so do not upload private documents. Your household details and reminders stay in this browser. This is not an official government service.")}
            </p>
          </>
        ) : (
          <>
            <section id="start" className="again" aria-label={t("Read another notice")}>
              {scanning && pending?.slot === "original" ? (
                scanning
              ) : (
                <>
                  <strong>{t("Read another notice")}</strong>
                  <div className="actions">
                    {picker("original", true, t("Take a photo"), "small")}
                    {picker("original", false, t("Choose a photo"), "ghost small")}
                  </div>
                </>
              )}
            </section>
            {error && (
              <div role="alert">
                <Banner tone="bad">{t(error)}</Banner>
              </div>
            )}
          </>
        )}

        {thread && current && (
          <>
            <div id="result" tabIndex={-1} className="result-anchor" />
            {fixture && (
              <Banner tone="bad">
                <strong>{t("Sample.")}</strong> {t("This is a hand-written synthetic notice. It is not AI output and not a real notice.")}
              </Banner>
            )}

            {changes && (
              <Section id="changed" title={t("What changed?")} icon="refresh" tint="amber" className="changed">
                {changes.length === 0 ? (
                  <p>{t("Nothing important changed: the date, time, areas, office and documents are the same.")}</p>
                ) : (
                  <>
                    <ul className="diff">
                      {changes.map((c) => (
                        <li key={c.field}>
                          <span className="eyebrow">{c.label}</span>
                          <div className="diff-row">
                            <div className="diff-before">
                              <span className="sr">{t("Before:")} </span>
                              {c.before}
                            </div>
                            <span className="diff-arrow" aria-hidden="true">
                              <Icon name="arrow" />
                            </span>
                            <div className="diff-after">
                              <span className="sr">{t("Now:")} </span>
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
                        <strong>{t("Your plan needs updating: {n}", { n: updates.length })}</strong>
                        <br />
                        {t("Check:")} {updates.map((u) => t(u)).join(", ")}.
                      </Banner>
                    )}
                  </>
                )}
                <p className="muted">{t("Everything below now shows the newer notice.")}</p>
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

            <SaveCard

              key={`save-${thread.id}-${thread.revised ? "r" : "o"}`}

              notice={current.notice}

              language={current.language}

              user={user}

              onSaved={() => setSaves((n) => n + 1)}

            />

            <Related notice={current.notice} user={user} version={saves} onOpen={openSaved} />


            <section className="card revise" aria-labelledby="revise">
              <h2 id="revise" className="section-title">
                <span className="badge">
                  <Icon name="refresh" />
                </span>
                {t("Got a corrected notice later?")}
              </h2>
              <p>
                {t("Add the newer notice here only if it replaces the one above. We will show what changed and help you update your reminder.")}
              </p>
              {scanning && pending?.slot === "revised" ? (
                scanning
              ) : (
                <div className="actions">
                  {picker("revised", true, t("Photo of the new notice"))}
                  {picker("revised", false, t("Choose a photo"), "ghost")}
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
                      {t("Sample corrected notice")}
                    </button>
                  )}
                </div>
              )}
            </section>
          </>
        )}

        {user && (

          <>

            <MyNotices version={saves} onOpen={openSaved} onChange={() => setSaves((n) => n + 1)} />

            <AskBox mine language={language} />

          </>

        )}

        {!thread && <AskBox mine={false} language={language} />}


        {reminders.length > 0 && (
          <Section id="saved" title={t("My saved reminders")} icon="calendar" tint="green">
            <ul className="saved">
              {reminders.map((r) => (
                <li key={r.threadId}>
                  <DateTile date={r.date} language={language} />
                  <div>
                    <strong>{r.title}</strong>
                    <br />
                    {formatWhen(r, language)}
                    {r.sequence > 0 && <span className="muted"> ({t("updated {n}×", { n: r.sequence })})</span>}
                  </div>
                  <button
                    className="ghost small"
                    aria-label={t("Remove reminder for {title}", { title: r.title })}
                    onClick={() => setReminders(reminders.filter((x) => x.threadId !== r.threadId))}
                  >
                    {t("Remove")}
                  </button>
                </li>
              ))}
            </ul>
            <p className="muted">{t("Kept only in this browser. Removing one here does not change your calendar.")}</p>
          </Section>
        )}
      </main>

      <footer>
        <div className="footer-wordmark">{t("A little less confusion.")}<br /><em>{t("A little more everyday confidence.")}</em></div>
        <div className="footer-badges">
          <span>Gemma 4 · open-weight model</span>
          <span>Open source · MIT</span>
          <span>Hacktoberfest Hack Day Bengaluru ’26</span>
        </div>
        <p>
          {t("The AI can make mistakes, so always check the original notice. Not an official government service.")}
        </p>
      </footer>
    </div>
    </LangContext.Provider>
  );
}
