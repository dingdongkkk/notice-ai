"use client";

import { useState } from "react";
import { translator } from "@/lib/i18n";
import type { Language } from "@/lib/schema";
import { useStored } from "@/lib/store";
import { Icon } from "../icons";

export default function Login() {
  const [language] = useStored<Language>("nta.language", "en");
  const t = translator(language);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: mode, username, password }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || "Something went wrong. Please try again.");
      // A full page load, so the home page starts with the new session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  const signup = mode === "signup";
  return (
    <div className="app" lang={language}>
      <main className="login">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="brand" href="/">
          <span className="mark" aria-hidden="true">
            <Icon name="arrow" />
          </span>
          <span>
            Notice<span className="brand-arrow"> → </span>Action
          </span>
        </a>
        <form className="card" onSubmit={submit}>
          <h1>{t(signup ? "Create your account" : "Sign in to your account")}</h1>
          <p className="muted">{t("Your saved notices and questions stay private to your account.")}</p>
          <label className="field">
            {t("Username")}
            <input
              type="text"
              name="username"
              value={username}
              autoComplete="username"
              autoCapitalize="none"
              required
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="field">
            {t("Password")}
            <input
              type="password"
              name="password"
              value={password}
              autoComplete={signup ? "new-password" : "current-password"}
              minLength={8}
              required
              onChange={(e) => setPassword(e.target.value)}
            />
            {signup && <span className="muted">{t("At least 8 characters.")}</span>}
          </label>
          {error && (
            <p className="form-error" role="alert">
              {t(error)}
            </p>
          )}
          <button className="wide" disabled={busy}>
            {t(signup ? "Create account" : "Sign in")}
          </button>
          <button
            type="button"
            className="proof-btn"
            onClick={() => {
              setMode(signup ? "login" : "signup");
              setError("");
            }}
          >
            {t(signup ? "Already have an account? Sign in" : "New here? Create an account")}
          </button>
        </form>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/">{t("Back to home")}</a>
      </main>
    </div>
  );
}
