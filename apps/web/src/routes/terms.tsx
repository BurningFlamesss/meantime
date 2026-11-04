import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Shell } from "../lib/shell";

export const Route = createFileRoute("/terms")({
  component: Terms,
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

function Terms() {
  return (
    <Shell>
      <article className="mx-auto max-w-3xl py-4">
        <p className="text-sm font-medium text-neutral-500">Legal</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">
          Terms of service
        </h1>
        <p className="mt-2 text-sm text-neutral-500">Last updated 4 November 2026</p>
        <p className="mt-4 text-sm leading-relaxed text-neutral-600">
          These terms cover this self-hosted MeanTime deployment. The operator of the instance
          provides it; the authors of the open-source repository do not run it and are not a
          party to your account. This is a working draft for a development deployment, not legal
          advice.
        </p>

        <div className="mt-6">
          <Section title="Using MeanTime">
            <p>
              By creating an account you agree to these terms and to the deployment's privacy
              policy. You must be at least 18 and provide accurate account and payout details.
              One person may not operate multiple accounts to multiply earnings.
            </p>
          </Section>

          <Section title="How you earn">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                You receive 55% of what an advertiser pays for a verified view. A view counts
                only after 5,000 ms of cumulative active time while the ad is at least 75%
                visible, the page is visible, and the window is focused.
              </li>
              <li>
                Earnings are credited per verified view through a double-entry ledger. Pending
                amounts may be reversed if a view is later found to be fraudulent.
              </li>
              <li>
                There is no minimum activity and no guaranteed income. Ad availability depends on
                advertiser demand.
              </li>
            </ul>
          </Section>

          <Section title="Payouts">
            <p>
              Payout requests require at least $5.00 of available balance and are reviewed by an
              operator before approval. Supported method labels are PayPal, Stripe Connect, Wise,
              USDC, and USDT. In this build no payment processor is connected: approved requests
              are recorded and debited from your balance, but funds are not transferred
              automatically. Do not request a payout expecting an automatic transfer.
            </p>
          </Section>

          <Section title="Advertisers">
            <p>
              Advertisers are responsible for the copy, links, and landing pages they submit.
              Campaigns are text-only, labelled, and limited to three creatives sharing one
              budget and bid. The operator may reject, pause, or remove a campaign that violates
              policy or fails moderation. Moderation can fail closed to human review. Spend is
              charged per verified view; this build does not provide refunds or an automated
              settlement path.
            </p>
          </Section>

          <Section title="Prohibited conduct">
            <ul className="list-disc space-y-2 pl-5">
              <li>Automating views, clicks, signups, or task submissions.</li>
              <li>Tampering with the extension, leases, telemetry, or the ledger.</li>
              <li>Submitting malware, phishing, fraud, or deceptive creative.</li>
              <li>Uploading proof images you do not have the right to share.</li>
              <li>Using the service to break the law or another service's terms.</li>
            </ul>
            <p>
              Violations can freeze an account, void pending earnings, and forfeit referral
              bonuses. Referral bonuses vest only after the referred user earns $1.00 from
              verified views.
            </p>
          </Section>

          <Section title="The extension">
            <p>
              The extension is provided as-is. It runs only on the named AI chat sites, shows one
              text ad at a time, and can be paused or disabled at any time. It is designed to fail
              silently: if it cannot reach the API or mount an ad, nothing is shown.
            </p>
          </Section>

          <Section title="Availability and warranties">
            <p>
              The service is provided without warranties of any kind, to the extent permitted by
              law. It may be unavailable, lose data, or change features. The operator is not
              liable for indirect or consequential losses, or for lost earnings, to the extent
              permitted by law. Nothing here limits rights that cannot be limited by law.
            </p>
          </Section>

          <Section title="Suspension and termination">
            <p>
              You may stop using the service at any time. The operator may suspend or terminate
              an account for fraud, abuse, or a legal requirement. Balances tied to confirmed
              fraud may be voided.
            </p>
          </Section>

          <Section title="Changes and contact">
            <p>
              Material changes will be reflected in the date at the top of this page. Continued
              use after a change means you accept the updated terms. Questions go to the operator
              of this deployment.
            </p>
          </Section>
        </div>

        <p className="mt-8 text-sm text-neutral-500">
          See also the <Link to="/privacy" className="underline hover:text-neutral-900">privacy policy</Link>.
        </p>
      </article>
    </Shell>
  );
}
