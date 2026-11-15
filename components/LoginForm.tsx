"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("demo@codequest.app");
  const [name, setName] = useState("Demo Learner");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, name: name || undefined }),
      });
      const data = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(data.error?.message ?? "Could not sign in.");
        setBusy(false);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Network error — is the dev server running?");
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="field">
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          className="input"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="name">
          Display name <span className="muted">(optional)</span>
        </label>
        <input
          id="name"
          className="input"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Enter CodeQuest"}
      </button>
    </form>
  );
}
