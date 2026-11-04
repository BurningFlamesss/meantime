import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <main className="bg-white">
      <nav className="border-b border-neutral-200">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-neutral-900 text-[11px] font-bold text-white">
              m
            </span>
            <span className="text-[15px] font-semibold tracking-tight">MeanTime</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/sign-in" className="btn-ghost">
              Sign in
            </Link>
            <Link to="/sign-up" className="btn-primary">
              Get started
            </Link>
          </div>
        </div>
      </nav>

      <section className="mx-auto max-w-3xl px-6 pb-20 pt-24 text-center">
        <p className="text-sm font-medium text-neutral-500">
          Ads, only when you're already waiting
        </p>
        <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight text-neutral-900 sm:text-5xl">
          Earn while the AI thinks.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-neutral-600">
          MeanTime shows a single line of text during the gap between your
          prompt and the AI's reply. No banners, no pop-ups — and 55% of every
          dollar goes to you.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link to="/sign-up" className="btn-primary px-5 py-2.5">
            Start earning
          </Link>
          <Link to="/advertiser" className="btn-outline px-5 py-2.5">
            Advertise
          </Link>
        </div>
        <p className="mt-4 text-xs text-neutral-400">
          Text-only · You control everything · Verified 5-second views
        </p>
      </section>

      <section className="border-t border-neutral-200 bg-neutral-50 py-16">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 px-6 sm:grid-cols-3">
          {[
            {
              title: "Users",
              body: "A quiet line of text during wait time. Dismiss anything, pause anytime, and keep 55% of every verified view.",
            },
            {
              title: "Advertisers",
              body: "Reach technical users at the exact moment they're paying attention — and pay only for 5 seconds of verified human focus.",
            },
            {
              title: "Everyone",
              body: "A transparent split, near-zero bandwidth, and an anti-fraud engine that protects all three sides.",
            },
          ].map((c) => (
            <div key={c.title}>
              <h3 className="text-sm font-semibold text-neutral-900">{c.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-neutral-200 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 text-sm text-neutral-400">
          <span>MeanTime — ads in the meantime.</span>
          <nav className="flex items-center gap-4">
            <Link to="/dashboard" className="hover:text-neutral-900">
              Dashboard
            </Link>
            <Link to="/privacy" className="hover:text-neutral-900">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-neutral-900">
              Terms
            </Link>
            <Link to="/sign-in" className="hover:text-neutral-900">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
