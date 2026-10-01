"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { School, SessionInfo } from "@/lib/types";
import { signInMethod } from "@/lib/method";

type LiveMethod = {
  hasPassword: boolean;
  providers: string[];
};

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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [schoolResponse, sessionResponse] = await Promise.all([
          fetch("/api/schools"),
          fetch("/api/session"),
        ]);
        const schoolPayload = (await schoolResponse.json()) as { schools?: School[]; error?: string };
        const sessionPayload = (await sessionResponse.json()) as { session?: SessionInfo | null };
        if (cancelled) return;
        if (!schoolResponse.ok) throw new Error(schoolPayload.error || "Could not load schools.");
        setSchools(schoolPayload.schools ?? []);
        setSession(sessionPayload.session ?? null);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load Somtoday.");
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
    return pool.slice(0, 12);
  }, [query, schools]);

  const listedMethod = selected ? signInMethod(selected) : null;
  const providers =
    liveMethod?.providers ?? (listedMethod?.kind === "sso" ? listedMethod.providers.map((provider) => provider.name) : []);
  const hasPassword = liveMethod?.hasPassword ?? listedMethod?.kind === "password";

  function chooseSchool(school: School) {
    selection.current = school.uuid;
    setSelected(school);
    setLiveMethod(null);
    setError(null);
    setDetecting(true);
    void fetch(`/api/method?uuid=${encodeURIComponent(school.uuid)}`)
      .then(async (response) => {
        const payload = (await response.json()) as { method?: LiveMethod; error?: string };
        if (selection.current !== school.uuid) return;
        if (!response.ok || !payload.method) throw new Error(payload.error || "Could not detect the sign-in method.");
        setLiveMethod(payload.method);
      })
      .catch((detectError: unknown) => {
        if (selection.current !== school.uuid) return;
        setError(detectError instanceof Error ? detectError.message : "Could not detect the sign-in method.");
      })
      .finally(() => {
        if (selection.current === school.uuid) setDetecting(false);
      });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uuid: selected.uuid, username, password }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Sign-in failed.");
      const sessionResponse = await fetch("/api/session");
      const sessionPayload = (await sessionResponse.json()) as { session?: SessionInfo | null; error?: string };
      if (!sessionResponse.ok || !sessionPayload.session) {
        throw new Error(sessionPayload.error || "Signed in, but student information did not load.");
      }
      setPassword("");
      setSession(sessionPayload.session);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function signOut() {
    await fetch("/api/logout", { method: "POST" });
    setSession(null);
  }

  if (loadingSession) {
    return (
      <main>
        <p className="eyebrow">Somtoday</p>
        <h1>Checking your session</h1>
      </main>
    );
  }

  if (session) {
    return (
      <main>
        <div className="top">
          <div>
            <p className="eyebrow">Signed in</p>
            <h1>{session.schoolName}</h1>
            <p className="lede">
              {session.schoolYear ? `School year ${session.schoolYear}.` : "Student information from Somtoday."}
              {session.tenant ? ` Tenant ${session.tenant}.` : ""}
            </p>
          </div>
          <button className="ghost" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>

        <section className="students">
          {session.students.length === 0 ? (
            <p className="empty">Somtoday returned no students for this account.</p>
          ) : (
            session.students.map((student) => (
              <article className="student" key={student.id || student.name}>
                <strong>{student.name}</strong>
                <p className="meta">
                  {student.studentNumber ? `Student number ${student.studentNumber}` : "No student number"}
                  {student.email ? ` · ${student.email}` : ""}
                </p>
              </article>
            ))
          )}
        </section>

        <h2>Recent grades</h2>
        <section className="grades">
          {session.grades.length === 0 ? (
            <p className="empty">No test grades were returned for the current year.</p>
          ) : (
            session.grades.map((grade, index) => (
              <article className="grade" key={`${grade.subject}-${grade.date}-${index}`}>
                <strong>{grade.subject}</strong>
                <b>{grade.result}</b>
                <span className="meta">{grade.description || "Test"}</span>
                <span className="meta">{grade.date || ""}</span>
              </article>
            ))
          )}
        </section>
      </main>
    );
  }

  return (
    <main>
      <p className="eyebrow">Somtoday</p>
      <h1>Sign in with your school</h1>
      <p className="lede">
        Choose your school. The page detects whether that school uses Somtoday credentials or an external sign-in, then
        opens a session and shows the student record.
      </p>

      <section className="panel">
        <label htmlFor="school">School</label>
        <input
          id="school"
          type="search"
          placeholder={loadingSchools ? "Loading schools…" : "Search by name or city"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={loadingSchools}
        />
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
                  <span>{school.plaats}</span>
                </span>
                <small>{schoolMethod.kind === "sso" ? "School SSO" : "Somtoday password"}</small>
              </button>
            );
          })}
          {!loadingSchools && results.length === 0 ? <p className="empty">No schools match that search.</p> : null}
        </div>

        {selected ? (
          <>
            <div className="method">
              <strong>{selected.naam}</strong>
              {detecting ? <p>Checking how this school signs in…</p> : null}
              {!detecting && providers.length === 0 ? <p>This school uses a Somtoday username and password.</p> : null}
              {!detecting && providers.length > 0 ? (
                <>
                  <p>
                    {hasPassword
                      ? "This school accepts a Somtoday password, and also an external sign-in."
                      : `Continue with ${providers[0]}. A browser window opens for that sign-in, then this page shows the student record.`}
                  </p>
                  <div className="chips">
                    {providers.map((provider) => (
                      <span key={provider}>{provider}</span>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
            <form onSubmit={(event) => void onSubmit(event)}>
              <div>
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                />
              </div>
              {hasPassword || providers.length === 0 ? (
                <div>
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
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
                    ? providers.length > 0 && !hasPassword
                      ? "Waiting for the school window…"
                      : "Signing in…"
                    : providers.length > 0 && !hasPassword
                      ? `Continue with ${providers[0]}`
                      : "Sign in"}
                </button>
              </div>
            </form>
          </>
        ) : null}

        {error ? <p className="error">{error}</p> : null}
      </section>
    </main>
  );
}
