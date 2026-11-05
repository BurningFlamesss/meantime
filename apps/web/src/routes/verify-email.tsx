import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";

export interface VerifyEmailSearch {
  token?: string;
}

export const Route = createFileRoute("/verify-email")({
  validateSearch: (search: Record<string, unknown>): VerifyEmailSearch => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();

  const [state, setState] = useState<"verifying" | "success" | "error" | "idle">(
    token ? "verifying" : "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [email, setEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;

    async function verify() {
      try {
        await api<{ ok: boolean; message: string }>("/auth/verify-email", {
          method: "POST",
          json: { token },
        });
        if (active) setState("success");
      } catch (err) {
        if (!active) return;
        setState("error");
        if (err instanceof ApiError) {
          setErrorMessage(
            err.status === 400
              ? "This verification link is invalid or has already expired."
              : "Could not verify your email. Please try again.",
          );
        } else {
          setErrorMessage("Could not reach the server. Please try again.");
        }
      }
    }

    void verify();
    return () => {
      active = false;
    };
  }, [token]);

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setResending(true);
    setResendStatus(null);
    try {
      await api<{ ok: boolean; message: string }>("/auth/resend-verification", {
        method: "POST",
        json: { email: email.trim().toLowerCase() },
      });
      setResendStatus("A new verification link has been sent to your email address.");
    } catch {
      setResendStatus("Failed to send verification email. Please try again in a few minutes.");
    } finally {
      setResending(false);
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
          {state === "verifying" && (
            <div className="text-center py-6">
              <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
                Verifying your email…
              </h1>
              <p className="mt-2 text-sm text-neutral-500">
                Please wait while we confirm your email address.
              </p>
            </div>
          )}

          {state === "success" && (
            <div className="py-4">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
                ✓ Verified
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
                Email confirmed
              </h1>
              <p className="mt-2 text-sm text-neutral-600">
                Your email address has been successfully verified. You now have full access to your MeanTime account.
              </p>
              <div className="mt-6 flex flex-col gap-2">
                <button
                  onClick={() => void navigate({ to: "/dashboard" })}
                  className="btn-primary w-full"
                >
                  Continue to dashboard
                </button>
                <Link to="/sign-in" className="btn-ghost w-full text-center">
                  Sign in
                </Link>
              </div>
            </div>
          )}

          {state === "error" && (
            <div className="py-4">
              <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
                Verification failed
              </h1>
              <p className="mt-2 text-sm text-neutral-600">
                {errorMessage || "The verification link is invalid or has expired."}
              </p>
              <form onSubmit={handleResend} className="mt-6 space-y-4">
                <div>
                  <label className="label" htmlFor="resend-email">
                    Request a new verification link
                  </label>
                  <input
                    id="resend-email"
                    type="email"
                    className="input"
                    placeholder="Enter your email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                {resendStatus && (
                  <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
                    {resendStatus}
                  </p>
                )}
                <button type="submit" disabled={resending} className="btn-primary w-full">
                  {resending ? "Sending…" : "Resend verification email"}
                </button>
              </form>
            </div>
          )}

          {state === "idle" && (
            <div className="py-4">
              <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
                Verify your email
              </h1>
              <p className="mt-2 text-sm text-neutral-600">
                Enter your email address below and we'll send you a new verification link.
              </p>
              <form onSubmit={handleResend} className="mt-6 space-y-4">
                <div>
                  <label className="label" htmlFor="idle-email">
                    Email address
                  </label>
                  <input
                    id="idle-email"
                    type="email"
                    className="input"
                    placeholder="name@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                {resendStatus && (
                  <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
                    {resendStatus}
                  </p>
                )}
                <button type="submit" disabled={resending} className="btn-primary w-full">
                  {resending ? "Sending…" : "Send verification link"}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
