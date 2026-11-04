import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Shell } from "../lib/shell";

export const Route = createFileRoute("/privacy")({
  component: Privacy,
});

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-neutral-200 py-6 first:border-t-0 first:pt-0">
      <h2 className="text-base font-semibold tracking-tight text-neutral-900">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-neutral-600">{children}</div>
    </section>
  );
}

function Privacy() {
  return (
    <Shell>
      <article className="mx-auto max-w-3xl py-4">
        <p className="text-sm font-medium text-neutral-500">Legal</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">
          Privacy policy
        </h1>
        <p className="mt-2 text-sm text-neutral-500">Last updated 4 November 2026</p>
        <p className="mt-4 text-sm leading-relaxed text-neutral-600">
          This page describes what the MeanTime software collects in this deployment. MeanTime
          is self-hosted: the operator running this instance is the data controller, not the
          authors of the open-source repository. This is a working draft for a development
          deployment, not legal advice.
        </p>

        <div className="mt-6">
          <Section title="What we collect">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <b>Account:</b> email address, password hash, display name if you provide one,
                country if set, and account timestamps.
              </li>
              <li>
                <b>Device and session:</b> a hashed device fingerprint, user agent, extension
                version, last-seen time, and refresh-session records.
              </li>
              <li>
                <b>Network:</b> a salted hash of your IP address, a coarse geographic cluster
                (region level, not a precise location), ASN, and the date seen. Raw IP addresses
                are never written to the database.
              </li>
              <li>
                <b>Ad activity:</b> which campaign and creative was shown, the placement and
                display mode, how long the ad was actually visible, hover duration, whether a
                hover was intentional, the AI wait duration, a click timestamp, and the coarse
                geographic cluster for views and clicks.
              </li>
              <li>
                <b>Social tasks:</b> the post URL you submit, the task type, the proof image you
                upload, and the review outcome.
              </li>
              <li>
                <b>Money:</b> your ledger balance, payout destination, payout requests, and
                referral relationships.
              </li>
            </ul>
          </Section>

          <Section title="What we never collect">
            <p>
              Prompt text and AI responses are never read, stored, or transmitted. The extension
              observes only whether you are actively typing or pasting (keystroke and paste
              counts) to detect automated traffic; it does not inspect the content. Raw IP
              addresses are not stored. Ads are text-only, and the extension does not read page
              content outside the host sites' response regions.
            </p>
          </Section>

          <Section title="Extension storage">
            <p>
              The extension keeps your session tokens, settings, a small ad cache, and an
              unsent telemetry queue in <code className="text-xs">chrome.storage.local</code>.
              This data stays in your browser profile and is removed when you sign out or
              uninstall the extension. It is not shared with the sites you visit.
            </p>
          </Section>

          <Section title="How we use it">
            <ul className="list-disc space-y-2 pl-5">
              <li>To serve one ad at a time and verify that a view was genuinely visible.</li>
              <li>To credit earnings and keep the double-entry ledger balanced.</li>
              <li>To detect fraud, replay, and automated traffic.</li>
              <li>To review advertiser creative, task proofs, and payout requests.</li>
              <li>To show advertisers aggregate campaign metrics, including coarse region.</li>
            </ul>
          </Section>

          <Section title="Sharing">
            <p>
              This build includes no third-party analytics, pixels, telemetry SDKs, or ad
              networks. Moderation runs on the operator's own Laya classifier. Payout processors
              are not connected in this deployment, so no payment details are sent anywhere when
              you request a payout. If a processor is connected later, this page must be updated
              before it goes live.
            </p>
          </Section>

          <Section title="Retention and your choices">
            <p>
              Records are kept while your account is open and while they are needed for fraud
              prevention and financial reconciliation. There is no automated deletion job in this
              build. To request access, correction, export, or deletion, contact the operator of
              this deployment. Deleting an account may not remove anonymised fraud or ledger
              records that the operator is required to keep.
            </p>
          </Section>

          <Section title="Security">
            <p>
              Passwords are hashed, IPs are salted-hashed, paid impressions require a
              single-use signed lease, and access to the reviewer surface requires an operator
              key. A production deployment must serve the API and web app over HTTPS; the local
              development defaults use plain HTTP on loopback.
            </p>
          </Section>

          <Section title="Children">
            <p>
              MeanTime is for adults. You must be at least 18 years old to create an account or
              receive payouts.
            </p>
          </Section>

          <Section title="Changes and contact">
            <p>
              Material changes will be reflected in the date at the top of this page. Questions
              go to the operator of this deployment.
            </p>
          </Section>
        </div>

        <p className="mt-8 text-sm text-neutral-500">
          See also the <Link to="/terms" className="underline hover:text-neutral-900">terms of service</Link>.
        </p>
      </article>
    </Shell>
  );
}
