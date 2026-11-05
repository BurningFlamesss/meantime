import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CAMPAIGN_DURATION, PAYOUT_THRESHOLD_USD, type TransparencyLogEntry, type UserBalance } from "@meantime/shared";
import { api } from "../lib/api";
import { formatMicro, formatMicroCents, formatMs } from "../lib/format";
import { Shell, PageHeader } from "../lib/shell";
import { Stat, Badge, Empty, Table } from "../lib/ui";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const [balance, setBalance] = useState<UserBalance | null>(null);
  const [log, setLog] = useState<TransparencyLogEntry[]>([]);
  const [maxAdDurationSec, setMaxAdDurationSec] = useState<number>(15);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<string | null>(null);

  useEffect(() => {
    api<UserBalance>("/me/balance").then(setBalance).catch((e) => setError(String(e)));
    api<TransparencyLogEntry[]>("/me/impressions").then(setLog).catch(() => undefined);
    api<{ maxAdDurationSec: number }>("/me/settings")
      .then((s) => setMaxAdDurationSec(s.maxAdDurationSec ?? 15))
      .catch(() => undefined);
  }, []);

  async function resendVerification(): Promise<void> {
    setResending(true);
    setResendStatus(null);
    try {
      await api<{ ok: boolean; message: string }>("/auth/resend-verification", {
        method: "POST",
      });
      setResendStatus("Sent!");
      setTimeout(() => setResendStatus(null), 5000);
    } catch {
      setResendStatus("Failed to send");
      setTimeout(() => setResendStatus(null), 5000);
    } finally {
      setResending(false);
    }
  }

  async function updateMaxDuration(sec: number): Promise<void> {
    setMaxAdDurationSec(sec);
    setSavingSettings(true);
    setSettingsSaved(false);
    try {
      await api<{ success: boolean; maxAdDurationSec: number }>("/me/settings", {
        method: "PATCH",
        json: { maxAdDurationSec: sec },
      });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
    } catch {
      // Ignore
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Earnings"
        description="Your balance and a full, auditable log of every ad."
      />

      {balance && balance.emailVerified === false && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-center gap-2">
            <span className="font-semibold">Verify your email:</span>
            <span>Check your inbox for a verification link to confirm your account.</span>
          </div>
          <button
            onClick={() => void resendVerification()}
            disabled={resending}
            className="rounded border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            {resending ? "Sending…" : resendStatus ? resendStatus : "Resend email"}
          </button>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-600">Failed to load: {error}</p>}

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Available" value={balance ? formatMicroCents(balance.availableMicro) : "—"} />
        <Stat label="Pending verification" value={balance ? formatMicro(balance.pendingMicro) : "—"} />
        <Stat label="Lifetime earned" value={balance ? formatMicro(balance.lifetimeMicro) : "—"} />
        <div className="card-pad">
          <p className="text-[13px] text-neutral-500">To withdrawal</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{
                width: `${balance ? Math.min(100, (balance.availableMicro / balance.thresholdMicro) * 100) : 0}%`,
              }}
            />
          </div>
          <p className="tabular mt-2 text-sm font-medium text-neutral-700">
            {balance ? formatMicroCents(balance.availableMicro) : "—"}{" "}
            <span className="font-normal text-neutral-400">
              / {formatMicroCents(PAYOUT_THRESHOLD_USD)}
            </span>
          </p>
        </div>
      </section>

      <section className="mt-8">
        <div className="card-pad max-w-xl">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">Maximum ad duration</h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                You will only be served ads that require up to this view time. Longer ads pay more per view.
              </p>
            </div>
            <span className="tabular text-sm font-semibold text-neutral-900">{maxAdDurationSec}s</span>
          </div>
          <div className="mt-4">
            <input
              type="range"
              min={CAMPAIGN_DURATION.MIN_SEC}
              max={CAMPAIGN_DURATION.MAX_SEC}
              step={1}
              value={maxAdDurationSec}
              onChange={(e) => void updateMaxDuration(Number(e.target.value))}
              className="w-full accent-neutral-900"
            />
            <div className="mt-1 flex justify-between text-[11px] text-neutral-400">
              <span>2s (quickest)</span>
              <span>5s (standard)</span>
              <span>15s (highest earnings)</span>
            </div>
          </div>
          {settingsSaved && <p className="mt-2 text-xs font-medium text-emerald-600">Saved preference.</p>}
          {savingSettings && <p className="mt-2 text-xs text-neutral-400">Saving…</p>}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Transparency log</h2>
        <Table head={["When", "Platform", "Ad", "View time", "Status", "Earned"]}>
          {log.map((entry) => (
            <tr key={entry.impressionId}>
              <td className="px-4 py-3 text-neutral-500">
                {new Date(entry.viewedAt).toLocaleString()}
              </td>
              <td className="px-4 py-3 capitalize">{entry.platform}</td>
              <td className="max-w-[220px] truncate px-4 py-3">{entry.campaignHeadline}</td>
              <td className="tabular px-4 py-3">{formatMs(entry.cumulativeVisibleMs)}</td>
              <td className="px-4 py-3">
                <Badge tone={entry.eligible ? "good" : "neutral"}>
                  {entry.eligible ? "Eligible" : "Early close"}
                </Badge>
              </td>
              <td className="tabular px-4 py-3 text-right">
                {entry.eligible ? formatMicro(entry.earnedMicro) : "—"}
              </td>
            </tr>
          ))}
          {log.length === 0 && (
            <tr>
              <td colSpan={6}>
                <Empty
                  title="No impressions yet"
                  hint="Install the extension and send a prompt to any supported AI."
                />
              </td>
            </tr>
          )}
        </Table>
      </section>
    </Shell>
  );
}
