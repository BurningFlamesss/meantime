import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ApiError, api, setToken } from "./api";

interface AuthResponse {
  accessToken: string;
}

/** Shared email/password form for /sign-in and /sign-up. */
export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const navigate = useNavigate();
  const registering = mode === "sign-up";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<AuthResponse>(registering ? "/auth/register" : "/auth/login", {
        method: "POST",
        json: { email: email.trim().toLowerCase(), password },
      });
      setToken(res.accessToken);
      await navigate({ to: "/dashboard" });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.status === 409
            ? "An account with that email already exists."
            : err.status === 401
              ? "Email or password is incorrect."
              : err.status === 429
                ? "Too many attempts. Try again in a few minutes."
                : err.status === 400
                  ? "Check your email and use a password of at least 10 characters."
                  : "Could not reach the server. Try again.",
        );
      } else {
        setError("Could not reach the server. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-neutral-900 text-[11px] font-bold text-white">
            m
          </span>
          <span className="text-[15px] font-semibold tracking-tight">MeanTime</span>
        </Link>

        <div className="card-pad mt-6">
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
            {registering ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {registering
              ? "Start earning 55% of every verified ad view."
              : "Sign in to see your balance and payouts."}
          </p>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <label className="label" htmlFor="auth-email">
                Email
              </label>
              <input
                id="auth-email"
                className="input"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="auth-password">
                Password
              </label>
              <input
                id="auth-password"
                className="input"
                type="password"
                autoComplete={registering ? "new-password" : "current-password"}
                required
                minLength={registering ? 10 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {registering && (
                <p className="mt-1 text-xs text-neutral-400">At least 10 characters.</p>
              )}
            </div>
            {error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}
            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? "Please wait…" : registering ? "Create account" : "Sign in"}
            </button>
          </form>

          <p className="mt-4 text-sm text-neutral-500">
            {registering ? (
              <>
                Already have an account?{" "}
                <Link to="/sign-in" className="text-accent">
                  Sign in
                </Link>
              </>
            ) : (
              <>
                New here?{" "}
                <Link to="/sign-up" className="text-accent">
                  Create an account
                </Link>
              </>
            )}
          </p>
        </div>
      </div>
    </main>
  );
}
