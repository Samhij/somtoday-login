"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/app/components/AppShell";
import type { School, SessionInfo } from "@/lib/types";
import { signInMethod } from "@/lib/method";

type LiveMethod = {
  hasPassword: boolean;
  providers: string[];
};

type Theme = "light" | "dark";

type RememberedLogin = {
  schoolUuid: string;
  schoolName: string;
  schoolPlace: string;
  username: string;
  method: "sso" | "password";
};

function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "dark" ? "dark" : "light";
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={onToggle}
      aria-label={theme === "dark" ? "Schakel naar licht thema" : "Schakel naar donker thema"}
    >
      {theme === "dark" ? "Licht" : "Donker"}
    </button>
  );
}

export default function HomePage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<School | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loadingSchools, setLoadingSchools] = useState(true);
  const [loadingSession, setLoadingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const selection = useRef<string | null>(null);
  const [liveMethod, setLiveMethod] = useState<LiveMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("light");
  const [remembered, setRemembered] = useState<RememberedLogin | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const restoredRef = useRef(false);
  const autoSsoAttemptedRef = useRef(false);
  const skipAutoSsoRef = useRef(false);

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [schoolResponse, sessionResponse] = await Promise.all([
          fetch("/api/schools", { cache: "no-store" }),
          fetch("/api/session", { cache: "no-store" }),
        ]);
        const schoolPayload = (await schoolResponse.json()) as { schools?: School[]; error?: string };
        const sessionPayload = (await sessionResponse.json()) as { session?: SessionInfo | null };
        if (cancelled) return;
        if (!schoolResponse.ok) throw new Error(schoolPayload.error || "Scholen laden mislukt.");
        setSchools(schoolPayload.schools ?? []);
        setSession(sessionPayload.session ?? null);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Laden mislukt.");
      } finally {
        if (!cancelled) {
          setLoadingSchools(false);
          setLoadingSession(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = needle
      ? schools.filter((school) => `${school.naam} ${school.plaats}`.toLowerCase().includes(needle))
      : schools;
    return pool;
  }, [query, schools]);

  const listedMethod = selected ? signInMethod(selected) : null;
  const providers =
    liveMethod?.providers ?? (listedMethod?.kind === "sso" ? listedMethod.providers.map((provider) => provider.name) : []);
  const hasPassword = liveMethod?.hasPassword ?? listedMethod?.kind === "password";
  const ssoOnly = providers.length > 0 && !hasPassword;

  function applyTheme(next: Theme) {
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    setTheme(next);
  }

  function chooseSchool(school: School, options?: { fromRestore?: boolean }) {
    if (!options?.fromRestore) {
      skipAutoSsoRef.current = true;
    }
    selection.current = school.uuid;
    setSelected(school);
    setLiveMethod(null);
    setError(null);
    setDetecting(true);
    void fetch(`/api/method?uuid=${encodeURIComponent(school.uuid)}`)
      .then(async (response) => {
        const payload = (await response.json()) as { method?: LiveMethod; error?: string };
        if (selection.current !== school.uuid) return;
        if (!response.ok || !payload.method) throw new Error(payload.error || "Inloggen niet mogelijk.");
        setLiveMethod(payload.method);
      })
      .catch((detectError: unknown) => {
        if (selection.current !== school.uuid) return;
        setError(detectError instanceof Error ? detectError.message : "Inloggen niet mogelijk.");
      })
      .finally(() => {
        if (selection.current === school.uuid) setDetecting(false);
      });
  }

  async function submitLogin() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uuid: selected.uuid, username, password }),
      });
      const payload = (await response.json()) as { session?: SessionInfo; error?: string };
      if (!response.ok) throw new Error(payload.error || "Inloggen mislukt.");
      if (!payload.session) throw new Error("Gegevens laden mislukt.");
      setPassword("");
      setSession(payload.session);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Inloggen mislukt.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    skipAutoSsoRef.current = true;
    await submitLogin();
  }

  async function forgetRemembered() {
    skipAutoSsoRef.current = true;
    autoSsoAttemptedRef.current = true;
    await fetch("/api/login-prefs", { method: "DELETE", cache: "no-store" });
    setRemembered(null);
    setSelected(null);
    setLiveMethod(null);
    setUsername("");
    setPassword("");
    setQuery("");
    setError(null);
    selection.current = null;
  }

  async function signOut() {
    await fetch("/api/logout", { method: "POST" });
    setSession(null);
    // Re-apply remembered school/username; do not auto-open SSO again in-session.
    restoredRef.current = false;
    autoSsoAttemptedRef.current = false;
    skipAutoSsoRef.current = true;
  }

  // Restore school + username when there is no valid session.
  useEffect(() => {
    if (loadingSession || loadingSchools || session || restoredRef.current) return;
    restoredRef.current = true;
    let cancelled = false;

    async function restore(attempt = 0) {
      try {
        // Bypass Chromium HTTP disk cache — a cached {prefs:null} from the first
        // launch would otherwise stick across relaunches (and Mac in-app updates).
        const response = await fetch("/api/login-prefs", { cache: "no-store" });
        if (!response.ok) throw new Error("prefs");
        const payload = (await response.json()) as { prefs?: RememberedLogin | null };
        if (cancelled) return;
        if (!payload.prefs) return;
        const prefs = payload.prefs;
        setRemembered(prefs);
        setUsername(prefs.username);
        setQuery(prefs.schoolName);
        const match = schools.find((school) => school.uuid === prefs.schoolUuid);
        const school: School = match ?? {
          uuid: prefs.schoolUuid,
          naam: prefs.schoolName,
          plaats: prefs.schoolPlace || "-",
          providers: [],
        };
        chooseSchool(school, { fromRestore: true });
      } catch {
        if (cancelled) return;
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          if (!cancelled) await restore(attempt + 1);
          return;
        }
        // Give up for this mount; logout resets restoredRef for another try.
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
    // chooseSchool is stable enough for one-shot restore; schools list is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingSession, loadingSchools, session, schools]);

  // SSO: auto-open IdP once after restore. Password: focus wachtwoord.
  useEffect(() => {
    if (!remembered || !selected || detecting || !liveMethod) return;
    if (selected.uuid !== remembered.schoolUuid) return;

    const isSsoOnly = liveMethod.providers.length > 0 && !liveMethod.hasPassword;

    if (remembered.method === "password" || !isSsoOnly) {
      if (!isSsoOnly) {
        const frame = requestAnimationFrame(() => passwordRef.current?.focus());
        return () => cancelAnimationFrame(frame);
      }
      return;
    }

    if (skipAutoSsoRef.current || autoSsoAttemptedRef.current || submitting || !username.trim()) {
      return;
    }

    autoSsoAttemptedRef.current = true;
    void submitLogin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remembered, selected, detecting, liveMethod, username, submitting]);

  const toggle = (
    <ThemeToggle theme={theme} onToggle={() => applyTheme(theme === "dark" ? "light" : "dark")} />
  );

  if (loadingSession) {
    return (
      <div className="shell fade-in">
        <div className="bar">
          <p className="brand">Cyfers</p>
          {toggle}
        </div>
        <h1>Even geduld</h1>
        <p className="lede">Sessie controleren…</p>
      </div>
    );
  }

  if (session) {
    return <AppShell schoolName={session.schoolName} onSignOut={() => void signOut()} themeToggle={toggle} />;
  }

  return (
    <div className="shell fade-in">
      <div className="bar">
        <p className="brand">Cyfers</p>
        {toggle}
      </div>
      <h1>Inloggen</h1>
      <p className="lede">
        {remembered ? "Welkom terug — je school en gebruikersnaam staan klaar." : "Kies je school en log in."}
      </p>

      <section className="block">
        <div className="field">
          <label htmlFor="school">School</label>
          <input
            id="school"
            type="search"
            placeholder={loadingSchools ? "Scholen laden…" : "Naam of plaats"}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={loadingSchools}
          />
        </div>

        <div className="results">
          {results.map((school) => {
            const schoolMethod = signInMethod(school);
            return (
              <button
                className={selected?.uuid === school.uuid ? "school selected" : "school"}
                key={school.uuid}
                type="button"
                onClick={() => chooseSchool(school)}
              >
                <span>
                  <strong>{school.naam}</strong>
                  {school.plaats && school.plaats !== "-" ? (
                    <span className="place">{school.plaats}</span>
                  ) : null}
                </span>
                <span className="tag">{schoolMethod.kind === "sso" ? "School" : "Wachtwoord"}</span>
              </button>
            );
          })}
          {!loadingSchools && results.length === 0 ? (
            <p className="empty">Geen scholen gevonden.</p>
          ) : null}
        </div>

        {selected ? (
          <>
            <p className="selected-school">
              {selected.naam}
              {detecting ? <span>Bezig…</span> : null}
            </p>
            <form onSubmit={(event) => void onSubmit(event)}>
              <div className="field">
                <label htmlFor="username">Gebruikersnaam</label>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => {
                    skipAutoSsoRef.current = true;
                    setUsername(event.target.value);
                  }}
                  required
                />
              </div>
              {!ssoOnly ? (
                <div className="field">
                  <label htmlFor="password">Wachtwoord</label>
                  <input
                    id="password"
                    ref={passwordRef}
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </div>
              ) : null}
              <div className="actions">
                <button className="primary" type="submit" disabled={submitting || detecting}>
                  {submitting
                    ? ssoOnly
                      ? "School-inloggen openen…"
                      : "Bezig…"
                    : ssoOnly && providers[0]
                      ? `Verder met ${providers[0]}`
                      : "Inloggen"}
                </button>
                {remembered ? (
                  <button className="ghost" type="button" onClick={() => void forgetRemembered()}>
                    Andere account
                  </button>
                ) : null}
              </div>
            </form>
          </>
        ) : null}

        {error ? <p className="error">{error}</p> : null}
      </section>
    </div>
  );
}
