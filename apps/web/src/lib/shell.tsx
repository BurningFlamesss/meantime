import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { clearToken, getToken } from "./api";

const NAV = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/tasks", label: "Tasks" },
  { to: "/referrals", label: "Referrals" },
  { to: "/payouts", label: "Payouts" },
  { to: "/advertiser", label: "Advertisers" },
  { to: "/admin", label: "Review" },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const { location } = useRouterState();
  const navigate = useNavigate();
  const [signedIn, setSignedIn] = useState(false);

  // Read localStorage after hydration to avoid an SSR/client mismatch.
  useEffect(() => {
    setSignedIn(!!getToken());
  }, [location.pathname]);

  function signOut(): void {
    clearToken();
    setSignedIn(false);
    void navigate({ to: "/sign-in" });
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-neutral-900 text-[11px] font-bold text-white">
              m
            </span>
            <span className="text-[15px] font-semibold tracking-tight">MeanTime</span>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map((item) => {
              const active = location.pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-neutral-100 text-neutral-900"
                      : "text-neutral-500 hover:text-neutral-900"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            {signedIn ? (
              <button
                onClick={signOut}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-neutral-500 transition-colors hover:text-neutral-900"
              >
                Sign out
              </button>
            ) : (
              <Link
                to="/sign-in"
                className="rounded-md px-3 py-1.5 text-sm font-medium text-neutral-500 transition-colors hover:text-neutral-900"
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-semibold tracking-tight text-neutral-900">{title}</h1>
      {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
    </div>
  );
}
