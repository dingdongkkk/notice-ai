"use client";

import { useEffect, useState } from "react";
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
  const [google, setGoogle] = useState(false);

  // Whether Google sign-in is configured, and whether a Google attempt just failed.
  useEffect(() => {
    fetch("/api/auth")
      .then((res) => res.json())
      .then((body) => {
        setGoogle(body?.google === true);
        const reason = new URLSearchParams(window.location.search).get("error");
        if (reason === "google") setError("Google sign-in did not complete. Please try again.");
        if (reason === "google-setup") setError("Google sign-in is not set up on this server.");
      })
      .catch(() => {});
  }, []);

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
          {google && (
            <>
              <a className="google-button" href="/api/auth/google">
                <svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.2 5.3-4.6 7l7.2 5.6c4.2-3.9 7.1-9.700 7.1-17.1z" />
                  <path fill="#FBBC05" d="M10.5 28.6c-.5-1.400-.8-3-.8-4.600s.3-3.200.8-4.600l-7.900-6.200C1 16.500 0 20.100 0 24s1 7.500 2.600 10.800l7.900-6.200z" />
                  <path fill="#34A853" d="M24 48c6.300 0 11.800-2.100 15.700-5.700l-7.200-5.600c-2.100 1.400-4.900 2.300-8.500 2.300-6.300 0-11.600-4.100-13.500-9.900l-7.900 6.200C6.500 42.600 14.600 48 24 48z" />
                </svg>
                {t("Continue with Google")}
              </a>
              <p className="divider-or">
                <span>{t("or")}</span>
              </p>
            </>
          )}
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
