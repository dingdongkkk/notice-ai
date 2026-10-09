"use client";

import { useState } from "react";
import {
  buildIcs,
  compareNotices,
  eventUid,
  familySummary,
  matchArea,
  type ConfirmedEvent,
} from "@/lib/actions";
import { FIXTURE_ORIGINAL, FIXTURE_REVISED, findRecord } from "@/lib/data";
import { LANGUAGES, isIsoDate, isTime, type Language, type Notice } from "@/lib/schema";

type Result = { notice: Notice; image: string | null; source: "live" | "fixture"; model?: string };

const SAVED_KEY = "notice-to-action.approved";

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
    throw new Error(body?.error || "Something went wrong. Try again.");
  }
  return { notice: body.notice, image, source: "live", model: body.model };
}

function AreaCheck({ notice }: { notice: Notice }) {
  const [area, setArea] = useState("");
  const match = matchArea(notice, area);
  return (
    <div className="card">
      <h2>Does this affect me?</h2>
      <label>
        My area
        <input
          type="text"
          value={area}
          placeholder="e.g. Mathikere"
          onChange={(e) => setArea(e.target.value)}
        />
      </label>
      {match === "affected" && (
        <div className="banner bad" role="status">
          <strong>Yes.</strong> Your area appears in the notice. Check the supporting passage.
        </div>
      )}
      {match === "not-listed" && (
        <div className="banner ok" role="status">
          Your area was not found in the areas read from the notice. Notices often say
          &quot;and surrounding areas&quot;, and spellings vary, so check the photo.
        </div>
      )}
      {match === "unknown" && notice.affectedAreas.length === 0 && (
        <p className="muted">No areas could be read from this notice.</p>
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
    u.onend = () => setState("idle");
    u.onerror = () => setState("idle");
    setState("speaking");
    window.speechSynthesis.speak(u);
  }
  return (
    <div className="row" style={{ marginTop: 8 }}>
      <button className="ghost" onClick={toggle}>
        {state === "speaking" ? "Stop reading" : "Read aloud"}
      </button>
      {state === "unavailable" && (
        <span className="muted">This device has no {LANGUAGES[language].name} voice installed.</span>
      )}
    </div>
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
      if (!res.ok || !body?.answer) throw new Error(body?.error || "Something went wrong. Try again.");
      setAnswer(body.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card">
      <h2>Ask about this notice</h2>
      <form className="row" onSubmit={ask}>
        <input
          type="text"
          value={question}
          maxLength={300}
          placeholder="e.g. Will tankers be arranged?"
          aria-label="Question about the notice"
          onChange={(e) => setQuestion(e.target.value)}
          style={{ flex: "1 1 220px" }}
        />
        <button disabled={busy || !question.trim()}>{busy ? "Asking…" : "Ask"}</button>
      </form>
      {error && <div className="banner bad" role="alert">{error}</div>}
      {answer && (
        <>
          <blockquote>{answer}</blockquote>
          <p className="muted">
            Answered by Gemma 4 from the facts shown above only. It can be wrong; check the notice.
          </p>
        </>
      )}
    </div>
  );
}

function NoticeView({ result, language }: { result: Result; language: Language }) {
  const n = result.notice;
  const record = findRecord(n);
  const [done, setDone] = useState<string[]>([]);
  return (
    <div className="grid">
      <div className="card">
        <h2>Original notice</h2>
        {result.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="preview" src={result.image} alt="Uploaded notice" />
        ) : (
          <p className="muted">Synthetic sample: there is no photo for this fixture.</p>
        )}
        <p className="muted">Check every fact on the right against this image.</p>
      </div>
      <div>
        <div className="card">
          <span className="tag">Explanation</span>
          <p>{n.explanation}</p>
          {n.requirements.length > 0 && (
            <>
              <span className="tag">What to do</span>
              <ul className="checklist">
                {n.requirements.map((r) => (
                  <li key={r}>
                    <label>
                      <input
                        type="checkbox"
                        checked={done.includes(r)}
                        onChange={(e) =>
                          setDone(e.target.checked ? [...done, r] : done.filter((d) => d !== r))
                        }
                      />
                      <span>{r}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          <ReadAloud text={[n.explanation, ...n.requirements].join(". ")} language={language} />
        </div>

        <AreaCheck notice={n} />

        <div className="card">
          <h2>Facts read from the notice</h2>
          <dl>
            <dt>Type</dt>
            <dd>{n.documentType ?? "not stated"}</dd>
            <dt>Issuer</dt>
            <dd>{n.issuer ?? "not stated"}</dd>
            <dt>Areas</dt>
            <dd>{n.affectedAreas.length ? n.affectedAreas.join(", ") : "not stated"}</dd>
            <dt>Date as written</dt>
            <dd>{n.dateText ?? "not stated"}</dd>
            <dt>Date</dt>
            <dd>{n.eventDate ?? "unresolved"}</dd>
            <dt>Time</dt>
            <dd>
              {n.startTime ?? "not stated"}
              {n.endTime ? ` to ${n.endTime}` : ""}
            </dd>
          </dl>
        </div>

        {n.unresolved.length > 0 && (
          <div className="banner warn">
            <strong>Needs your check</strong>
            <ul>
              {n.unresolved.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="card">
          <h2>Supporting passages</h2>
          <p className="muted">
            Transcribed by the model. Compare with the photo; a quote is not proof on its own.
          </p>
          {n.evidence.length === 0 && <p>No passages were returned.</p>}
          {n.evidence.map((e, i) => (
            <div key={i}>
              <span className="tag">{e.field}</span>
              <blockquote>{e.quote}</blockquote>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>External information</h2>
          {record ? (
            <>
              <p>
                <strong>{record.service}</strong>: {record.detail}
              </p>
              <p className="muted">
                Shown because: {record.matchRule}
                <br />
                Source:{" "}
                <a href={record.sourceUrl} target="_blank" rel="noreferrer">
                  {record.sourceUrl}
                </a>
                <br />
                {record.retrieved
                  ? `Retrieved on ${record.retrieved}.`
                  : "Not yet checked against the source by a person. Confirm before relying on it."}
              </p>
            </>
          ) : (
            <p>No matching public record for this notice.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Actions({ notice }: { notice: Notice }) {
  const [date, setDate] = useState(notice.eventDate ?? "");
  const [start, setStart] = useState(notice.startTime ?? "");
  const [end, setEnd] = useState(notice.endTime ?? "");
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState("");

  const confirmed: ConfirmedEvent | null =
    checked && isIsoDate(date)
      ? { date, startTime: isTime(start) ? start : null, endTime: isTime(end) ? end : null }
      : null;
  const summary = familySummary(notice, confirmed);

  function download() {
    if (!confirmed) return;
    const uid = eventUid(notice, confirmed);
    let saved: string[] = [];
    try {
      saved = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
    } catch {}
    const repeat = saved.includes(uid);
    if (!repeat) {
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify([...saved, uid]));
      } catch {}
    }
    const blob = new Blob([buildIcs(notice, confirmed)], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `notice-${confirmed.date}.ics`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(
      repeat
        ? "Downloaded again. This reminder was already approved, so no new action was saved."
        : "Calendar file downloaded. Open it to add the reminder to your calendar.",
    );
  }

  async function share() {
    if (!navigator.share) return copy();
    try {
      await navigator.share({ text: summary });
    } catch {}
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(summary);
      setStatus("Summary copied. Paste it wherever you want to share it.");
    } catch {
      setStatus("Could not copy automatically. Select the text and copy it.");
    }
  }

  return (
    <div className="card">
      <h2>Approve actions</h2>
      <p className="muted">Nothing is saved or exported until you confirm the date yourself.</p>
      <div className="row">
        <label>
          Date
          <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setChecked(false); }} />
        </label>
        <label>
          From
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          To
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <p>
        <label>
          <input
            type="checkbox"
            checked={checked}
            disabled={!isIsoDate(date)}
            onChange={(e) => setChecked(e.target.checked)}
          />
          I checked this date and time against the original notice
        </label>
      </p>
      {!isIsoDate(date) && (
        <div className="banner warn">The date is unresolved. Enter it from the notice to enable the reminder.</div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={download} disabled={!confirmed}>
          Approve and download calendar event
        </button>
      </div>
      <h2 style={{ marginTop: 16 }}>Family summary</h2>
      <textarea readOnly value={summary} aria-label="Family summary preview" />
      <div className="row">
        <button className="ghost" onClick={copy}>
          Copy summary
        </button>
        <button className="ghost" onClick={share}>
          Share…
        </button>
      </div>
      {status && <div className="banner ok" role="status">{status}</div>}
    </div>
  );
}

export default function Home() {
  const [language, setLanguage] = useState<Language>("en");
  const [original, setOriginal] = useState<Result | null>(null);
  const [revised, setRevised] = useState<Result | null>(null);
  const [busy, setBusy] = useState<"original" | "revised" | null>(null);
  const [error, setError] = useState("");

  async function onFile(file: File | undefined, slot: "original" | "revised") {
    if (!file) return;
    setError("");
    setBusy(slot);
    try {
      const result = await extract(file, language);
      if (slot === "original") {
        setOriginal(result);
        setRevised(null);
      } else {
        setRevised(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  }

  function loadFixture() {
    setError("");
    setOriginal({ notice: FIXTURE_ORIGINAL, image: null, source: "fixture" });
    setRevised(null);
  }

  const current = revised ?? original;
  const changes = original && revised ? compareNotices(original.notice, revised.notice) : null;
  const fixture = original?.source === "fixture" || revised?.source === "fixture";

  return (
    <main>
      <header className="hero">
        <h1>Notice → Action</h1>
        <p>
          Photograph a public notice. Get a plain explanation, the facts with their source text,
          and a reminder you approve.
        </p>
      </header>
      <div className="banner warn">
        Your photo is sent to a hosted AI service (Gemma 4 via OpenRouter) to be read. Do not
        upload private documents. This is not an official government service.
      </div>

      <div className="card">
        <div className="row">
          <label>
            Explain in
            <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
              {(Object.keys(LANGUAGES) as Language[]).map((l) => (
                <option key={l} value={l}>
                  {LANGUAGES[l].label}
                </option>
              ))}
            </select>
          </label>
          <label className="file">
            {busy === "original" ? "Reading…" : "Upload notice photo"}
            <input
              type="file"
              accept="image/*"
              disabled={busy !== null}
              onChange={(e) => { onFile(e.target.files?.[0], "original"); e.target.value = ""; }}
            />
          </label>
          <button className="ghost" onClick={loadFixture} disabled={busy !== null}>
            Load synthetic sample (no AI)
          </button>
        </div>
        {busy && <p className="muted" role="status">Gemma 4 is reading the notice. This can take up to a minute.</p>}
      </div>

      {error && <div className="banner bad" role="alert">{error}</div>}
      {fixture && (
        <div className="banner bad">
          DEMO FIXTURE: this is a hand-written synthetic sample, not live AI output and not a real
          notice.
        </div>
      )}

      {original && (
        <div className="card">
          <h2>Has the notice been revised?</h2>
          <p className="muted">
            Only upload a notice here if it replaces the one above. The two are compared field by
            field in code.
          </p>
          <div className="row">
            <label className="file ghost">
              {busy === "revised" ? "Reading…" : "Upload revised notice"}
              <input
                type="file"
                accept="image/*"
                disabled={busy !== null}
                onChange={(e) => { onFile(e.target.files?.[0], "revised"); e.target.value = ""; }}
              />
            </label>
            {original.source === "fixture" && (
              <button
                className="ghost"
                onClick={() => setRevised({ notice: FIXTURE_REVISED, image: null, source: "fixture" })}
              >
                Load synthetic revision
              </button>
            )}
          </div>
        </div>
      )}

      {changes && (
        <div className="card">
          <h2>What changed?</h2>
          {changes.length === 0 ? (
            <p>No differences in date, time, issuer or areas.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.field}>
                    <td>{c.field}</td>
                    <td>{c.before}</td>
                    <td>{c.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted">Showing the revised notice below.</p>
        </div>
      )}

      {current && (
        <>
          <NoticeView key={`v${JSON.stringify(current.notice)}`} result={current} language={language} />
          <Actions key={`a${JSON.stringify(current.notice)}`} notice={current.notice} />
          <Ask key={`q${JSON.stringify(current.notice)}`} notice={current.notice} language={language} />
          {current.model && <p className="muted">Read by {current.model}.</p>}
        </>
      )}
    </main>
  );
}
