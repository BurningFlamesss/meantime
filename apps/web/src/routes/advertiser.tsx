import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AD_COPY_LIMITS,
  type CampaignAnalytics,
  type CampaignInput,
  type ModerationOutcome,
} from "@meantime/shared";
import {
  ApiError,
  api,
  apiAsAdvertiser,
  clearAdvertiserToken,
  getAdvertiserToken,
  setAdvertiserToken,
} from "../lib/api";
import { formatMicroCents, formatMs } from "../lib/format";
import { Shell, PageHeader } from "../lib/shell";
import { Stat, Badge, Empty, Table } from "../lib/ui";

export const Route = createFileRoute("/advertiser")({
  component: AdvertiserPortal,
});

const GEO_CLUSTERS = [
  "NA-EAST", "NA-WEST", "EU-WEST", "EU-CENTRAL", "EU-EAST",
  "APAC-EAST", "APAC-SE", "LATAM", "AF-NORTH",
];

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  headline: string;
  cpiMicro: string;
  spentTotalMicro: string;
  moderationDecision?: string;
}

interface VariantRow {
  id: string;
  label: string;
  headline: string;
  bodyText: string;
  ctaText: string;
  moderationDecision?: string;
  views: number;
  verifiedViews: number;
  completionRate: number;
  avgRetentionMs: number;
}

/**
 * The portal runs on an advertiser token, which is stored separately from the
 * viewer session: signing in here never signs the user out of their earnings
 * dashboard, and a viewer token can never create or read campaigns.
 */
function AdvertiserPortal() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  // localStorage is read after mount so SSR output and hydration agree.
  useEffect(() => {
    setAuthed(!!getAdvertiserToken());
  }, []);

  if (authed === null) {
    return (
      <Shell>
        <PageHeader title="Advertiser portal" />
        <p className="text-sm text-neutral-400">—</p>
      </Shell>
    );
  }
  if (!authed) return <AdvertiserAuth onAuthed={() => setAuthed(true)} />;
  return <AdvertiserPortalContent onSignedOut={() => setAuthed(false)} />;
}

function AdvertiserAuth({ onAuthed }: { onAuthed: () => void }) {
  const [registering, setRegistering] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ accessToken: string }>(
        registering ? "/advertiser/register" : "/advertiser/login",
        {
          method: "POST",
          json: registering
            ? { email: email.trim().toLowerCase(), password, companyName: companyName.trim() }
            : { email: email.trim().toLowerCase(), password },
        },
      );
      setAdvertiserToken(res.accessToken);
      setPassword("");
      onAuthed();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 409
            ? "An advertiser with that email already exists."
            : err.status === 401
              ? "Email or password is incorrect."
              : err.status === 429
                ? "Too many attempts. Try again in a few minutes."
                : err.status === 400
                  ? "Check the form — passwords need at least 10 characters."
                  : "Could not reach the server. Try again."
          : "Could not reach the server. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Advertiser portal"
        description="Text-only micro-campaigns during AI wait time. Bid per verified 5-second human view."
      />
      <div className="max-w-md">
        <form onSubmit={submit} className="card-pad space-y-4">
          <h2 className="text-sm font-semibold text-neutral-900">
            {registering ? "Create an advertiser account" : "Advertiser sign in"}
          </h2>
          <div>
            <label className="label" htmlFor="adv-email">Work email</label>
            <input id="adv-email" className="input" type="email" autoComplete="email" required
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {registering && (
            <div>
              <label className="label" htmlFor="adv-company">Company</label>
              <input id="adv-company" className="input" required maxLength={80}
                value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </div>
          )}
          <div>
            <label className="label" htmlFor="adv-password">Password</label>
            <input id="adv-password" className="input" type="password" required
              autoComplete={registering ? "new-password" : "current-password"}
              minLength={registering ? 10 : 1}
              value={password} onChange={(e) => setPassword(e.target.value)} />
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
            {busy ? "Please wait…" : registering ? "Create advertiser account" : "Sign in"}
          </button>
          <p className="text-sm text-neutral-500">
            {registering ? "Already advertise with us?" : "New advertiser?"}{" "}
            <button type="button" onClick={() => { setRegistering(!registering); setError(null); }}
              className="text-accent">
              {registering ? "Sign in" : "Create an account"}
            </button>
          </p>
        </form>
        <p className="mt-4 text-xs text-neutral-400">
          Advertiser accounts are separate from viewer accounts. Campaign copy is
          moderated before it can serve.
        </p>
      </div>
    </Shell>
  );
}

function AdvertiserPortalContent({ onSignedOut }: { onSignedOut: () => void }) {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<CampaignAnalytics | null>(null);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [moderation, setModeration] = useState<ModerationOutcome | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showVariantForm, setShowVariantForm] = useState(false);
  const [variantForm, setVariantForm] = useState({ headline: "", bodyText: "", ctaText: "Learn more" });
  const [variantMsg, setVariantMsg] = useState<string | null>(null);

  const [form, setForm] = useState<CampaignInput>({
    name: "",
    headline: "",
    bodyText: "",
    ctaText: "Learn more",
    targetUrl: "",
    dailyBudgetMicro: 5_000_000,
    cpiMicro: 20_000,
    targetPlatforms: ["openai"],
    targetGeoClusters: [],
  });

  /** A rejected advertiser token returns the portal to its sign-in form. */
  function handleAuthFailure(err: unknown): void {
    if (err instanceof ApiError && err.status === 401) {
      clearAdvertiserToken();
      onSignedOut();
    }
  }

  async function refresh(): Promise<void> {
    try {
      setCampaigns(await apiAsAdvertiser<CampaignRow[]>("/advertiser/campaigns"));
    } catch (err) {
      handleAuthFailure(err);
      setCampaigns([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!selected) return;
    apiAsAdvertiser<CampaignAnalytics>(`/advertiser/campaigns/${selected}/analytics`)
      .then(setAnalytics)
      .catch((err: unknown) => {
        handleAuthFailure(err);
        setAnalytics(null);
      });
    apiAsAdvertiser<VariantRow[]>(`/advertiser/campaigns/${selected}/variants`)
      .then(setVariants)
      .catch((err: unknown) => {
        handleAuthFailure(err);
        setVariants([]);
      });
  }, [selected]);

  async function createCampaign(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setMessage(null);
    setModeration(null);
    try {
      const res = await apiAsAdvertiser<{
        campaign: { id: string };
        moderation: ModerationOutcome;
      }>("/advertiser/campaigns", { method: "POST", json: form });
      setModeration(res.moderation);
      setMessage(
        res.moderation.decision === "auto_approved"
          ? "Approved automatically and now live."
          : res.moderation.decision === "needs_review"
            ? "Sent to a reviewer — you'll be notified."
            : "Rejected by automatic policy checks.",
      );
      await refresh();
      setSelected(res.campaign.id);
    } catch (err) {
      handleAuthFailure(err);
      setMessage(String(err));
    }
  }

  async function createVariant(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!selected) return;
    setVariantMsg(null);
    try {
      const res = await apiAsAdvertiser<{ moderation: ModerationOutcome }>(
        `/advertiser/campaigns/${selected}/variants`,
        { method: "POST", json: variantForm },
      );
      setVariantMsg(
        res.moderation.decision === "auto_approved"
          ? "Variant approved and now rotating."
          : res.moderation.decision === "needs_review"
            ? "Variant sent to review."
            : "Variant rejected.",
      );
      setShowVariantForm(false);
      setVariantForm({ headline: "", bodyText: "", ctaText: "Learn more" });
      const rows = await apiAsAdvertiser<VariantRow[]>(
        `/advertiser/campaigns/${selected}/variants`,
      );
      setVariants(rows);
    } catch (err) {
      handleAuthFailure(err);
      setVariantMsg(String(err));
    }
  }

  function toggleGeo(cluster: string): void {
    setForm((f) => ({
      ...f,
      targetGeoClusters: f.targetGeoClusters.includes(cluster)
        ? f.targetGeoClusters.filter((c) => c !== cluster)
        : [...f.targetGeoClusters, cluster],
    }));
  }

  return (
    <Shell>
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Advertiser portal"
          description="Text-only micro-campaigns during AI wait time. Bid per verified 5-second human view."
        />
        <button
          onClick={() => {
            clearAdvertiserToken();
            onSignedOut();
          }}
          className="btn-outline shrink-0 text-xs"
        >
          Sign out
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Left: create form */}
        <form onSubmit={createCampaign} className="card-pad space-y-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-neutral-900">New campaign</h2>

          <div>
            <label className="label">Campaign name</label>
            <input required value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
          </div>
          <div>
            <label className="label">Headline <span className="font-normal text-neutral-400">({form.headline.length}/{AD_COPY_LIMITS.HEADLINE_MAX})</span></label>
            <input required maxLength={AD_COPY_LIMITS.HEADLINE_MAX} value={form.headline}
              onChange={(e) => setForm({ ...form, headline: e.target.value })} className="input" />
          </div>
          <div>
            <label className="label">Body <span className="font-normal text-neutral-400">({form.bodyText.length}/{AD_COPY_LIMITS.BODY_MAX})</span></label>
            <textarea required maxLength={AD_COPY_LIMITS.BODY_MAX} rows={3} value={form.bodyText}
              onChange={(e) => setForm({ ...form, bodyText: e.target.value })} className="input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">CTA text</label>
              <input required maxLength={AD_COPY_LIMITS.CTA_MAX} value={form.ctaText}
                onChange={(e) => setForm({ ...form, ctaText: e.target.value })} className="input" />
            </div>
            <div>
              <label className="label">Target URL</label>
              <input required type="url" value={form.targetUrl}
                onChange={(e) => setForm({ ...form, targetUrl: e.target.value })} className="input" />
            </div>
          </div>

          <div>
            <label className="label">Geo targeting <span className="font-normal text-neutral-400">(empty = worldwide)</span></label>
            <div className="flex flex-wrap gap-1.5">
              {GEO_CLUSTERS.map((cluster) => {
                const on = form.targetGeoClusters.includes(cluster);
                return (
                  <button type="button" key={cluster} onClick={() => toggleGeo(cluster)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-600 hover:border-neutral-400"
                    }`}>
                    {cluster}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Daily budget ($)</label>
              <input required type="number" min={1} step="0.01" value={form.dailyBudgetMicro / 1_000_000}
                onChange={(e) => setForm({ ...form, dailyBudgetMicro: Math.round(Number(e.target.value) * 1_000_000) })}
                className="input" />
            </div>
            <div>
              <label className="label">Bid per 5s view ($)</label>
              <input required type="number" min={0.001} step="0.001" value={form.cpiMicro / 1_000_000}
                onChange={(e) => setForm({ ...form, cpiMicro: Math.round(Number(e.target.value) * 1_000_000) })}
                className="input" />
            </div>
          </div>

          <button type="submit" className="btn-primary w-full">Create campaign</button>

          {moderation && (
            <div className={`rounded-lg border p-3 text-sm ${
              moderation.decision === "auto_approved" ? "border-accent/30 bg-accent-soft text-accent"
              : moderation.decision === "needs_review" ? "border-amber-300 bg-amber-50 text-amber-800"
              : "border-red-300 bg-red-50 text-red-700"
            }`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {moderation.decision === "auto_approved" ? "Auto-approved by Laya"
                  : moderation.decision === "needs_review" ? "Sent to review by Laya"
                  : "Auto-rejected by Laya"}
                </span>
                <span className="tabular text-xs">score {moderation.score}</span>
              </div>
              {moderation.reasons.length > 0 && (
                <p className="mt-1 text-xs opacity-80">{moderation.reasons.join(", ")}</p>
              )}
            </div>
          )}
          {message && !moderation && <p className="text-sm text-neutral-500">{message}</p>}
        </form>

        {/* Right: campaign list + analytics */}
        <div className="space-y-6 lg:col-span-3">
          <section>
            <h2 className="mb-3 text-sm font-semibold text-neutral-900">Campaigns</h2>
            <Table head={["Name", "Status", "Moderation", "Spend"]}>
              {campaigns.map((c) => (
                <tr key={c.id} onClick={() => setSelected(c.id)}
                  className={`cursor-pointer ${selected === c.id ? "bg-neutral-50" : "hover:bg-neutral-50"}`}>
                  <td className="px-4 py-3 font-medium text-neutral-900">{c.name}</td>
                  <td className="px-4 py-3 capitalize">{c.status}</td>
                  <td className="px-4 py-3">
                    {c.moderationDecision && (
                      <Badge tone={
                        c.moderationDecision === "auto_approved" ? "good"
                        : c.moderationDecision === "needs_review" ? "warn" : "bad"
                      }>
                        {c.moderationDecision.replace("_", " ")}
                      </Badge>
                    )}
                  </td>
                  <td className="tabular px-4 py-3">{formatMicroCents(Number(c.spentTotalMicro))}</td>
                </tr>
              ))}
              {campaigns.length === 0 && (
                <tr><td colSpan={4}><Empty title="No campaigns yet" hint="Create your first on the left." /></td></tr>
              )}
            </Table>
          </section>

          {analytics && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-neutral-900">Analytics</h2>
                {!showVariantForm && variants.length < 2 && (
                  <button onClick={() => setShowVariantForm(true)} className="btn-outline text-xs">
                    Add A/B variant
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Views" value={String(analytics.totals.views)} />
                <Stat label="Verified 5s views" value={String(analytics.totals.verifiedViews)}
                  hint={`${(analytics.totals.completionRate * 100).toFixed(0)}% completion`} />
                <Stat label="Intentional hovers" value={String(analytics.totals.intentionalHovers)} />
                <Stat label="Clicks" value={String(analytics.totals.clicks)}
                  hint={`${(analytics.totals.ctr * 100).toFixed(2)}% CTR`} />
              </div>

              {/* A/B variants */}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Creative variants
                </h3>
                <Table head={["Variant", "Headline", "Views", "Completion", "Avg retention", "Status"]}>
                  <tr>
                    <td className="px-4 py-3 font-medium text-neutral-900">A</td>
                    <td className="max-w-[180px] truncate px-4 py-3">{campaigns.find((c) => c.id === selected)?.headline}</td>
                    <td className="tabular px-4 py-3">—</td>
                    <td className="tabular px-4 py-3">—</td>
                    <td className="tabular px-4 py-3">—</td>
                    <td className="px-4 py-3"><Badge tone="good">base</Badge></td>
                  </tr>
                  {variants.map((v) => (
                    <tr key={v.id}>
                      <td className="px-4 py-3 font-medium text-neutral-900">{v.label}</td>
                      <td className="max-w-[180px] truncate px-4 py-3">{v.headline}</td>
                      <td className="tabular px-4 py-3">{v.views}</td>
                      <td className="tabular px-4 py-3">{(v.completionRate * 100).toFixed(0)}%</td>
                      <td className="tabular px-4 py-3">{formatMs(v.avgRetentionMs)}</td>
                      <td className="px-4 py-3">
                        <Badge tone={
                          v.moderationDecision === "auto_approved" ? "good"
                          : v.moderationDecision === "needs_review" ? "warn" : "bad"
                        }>
                          {v.moderationDecision?.replace("_", " ") ?? "—"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </Table>
              </div>

              {showVariantForm && (
                <form onSubmit={createVariant} className="card-pad space-y-3">
                  <h4 className="text-sm font-semibold text-neutral-900">New variant (B)</h4>
                  <div>
                    <label className="label">Headline</label>
                    <input required maxLength={AD_COPY_LIMITS.HEADLINE_MAX} value={variantForm.headline}
                      onChange={(e) => setVariantForm({ ...variantForm, headline: e.target.value })} className="input" />
                  </div>
                  <div>
                    <label className="label">Body</label>
                    <textarea required maxLength={AD_COPY_LIMITS.BODY_MAX} rows={2} value={variantForm.bodyText}
                      onChange={(e) => setVariantForm({ ...variantForm, bodyText: e.target.value })} className="input" />
                  </div>
                  <div>
                    <label className="label">CTA text</label>
                    <input required maxLength={AD_COPY_LIMITS.CTA_MAX} value={variantForm.ctaText}
                      onChange={(e) => setVariantForm({ ...variantForm, ctaText: e.target.value })} className="input" />
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="submit" className="btn-primary">Submit variant</button>
                    <button type="button" onClick={() => setShowVariantForm(false)} className="btn-ghost">Cancel</button>
                  </div>
                  {variantMsg && <p className="text-sm text-neutral-500">{variantMsg}</p>}
                </form>
              )}

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  By geography
                </h3>
                <Table head={["Cluster", "Unique users", "Views", "Verified", "Hovers", "Clicks", "Avg retention"]}>
                  {analytics.geo.map((g) => (
                    <tr key={g.geoCluster}>
                      <td className="px-4 py-3 font-medium text-neutral-900">{g.geoCluster}</td>
                      <td className="tabular px-4 py-3">{g.uniqueUsers}</td>
                      <td className="tabular px-4 py-3">{g.views}</td>
                      <td className="tabular px-4 py-3">{g.verifiedViews}</td>
                      <td className="tabular px-4 py-3">{g.intentionalHovers}</td>
                      <td className="tabular px-4 py-3">{g.clicks}</td>
                      <td className="tabular px-4 py-3">{formatMs(g.avgRetentionMs)}</td>
                    </tr>
                  ))}
                  {analytics.geo.length === 0 && (
                    <tr><td colSpan={7}><Empty title="No geo data yet" /></td></tr>
                  )}
                </Table>
              </div>
            </section>
          )}
        </div>
      </div>
    </Shell>
  );
}
