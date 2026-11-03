import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Shell, PageHeader } from "../lib/shell";
import { Badge, Empty, Table } from "../lib/ui";

export const Route = createFileRoute("/admin")({
  component: AdminReview,
});

interface CampaignRow {
  id: string;
  name: string;
  headline: string;
  bodyText: string;
  ctaText: string;
  targetUrl: string;
  status: string;
  moderationDecision: string | null;
  moderationScore: number | null;
  moderationReasons: string[];
}

interface VariantRow {
  id: string;
  campaignId: string;
  label: string;
  headline: string;
  bodyText: string;
  moderationScore: number | null;
  moderationReasons: string[];
}

interface TaskRow {
  id: string;
  userId: string;
  email: string | null;
  taskType: string;
  postUrl: string;
  screenshotKey: string;
  rewardMicro: string;
  moderationScore: number | null;
  moderationReasons: string[];
}

interface PayoutRow {
  id: string;
  userId: string;
  email: string | null;
  amountMicro: string;
  status: string;
  trustScoreAtRequest: number | null;
  address: string | null;
}

interface Queue {
  campaigns: CampaignRow[];
  variants: VariantRow[];
  tasks: TaskRow[];
  payouts: PayoutRow[];
}

const EMPTY: Queue = { campaigns: [], variants: [], tasks: [], payouts: [] };
const KEY_STORAGE = "mt_admin_key";

function AdminReview() {
  const [key, setKey] = useState("");
  const [queue, setQueue] = useState<Queue>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(KEY_STORAGE) ?? "";
    setKey(saved);
    if (saved) void load(saved);
  }, []);

  async function load(adminKey = key): Promise<void> {
    if (!adminKey) return;
    setError(null);
    try {
      const data = await api<Queue>("/admin/queue", { headers: { "x-admin-key": adminKey } });
      setQueue(data);
    } catch (err) {
      setQueue(EMPTY);
      setError(String(err));
    }
  }

  async function review(path: string, decision: "approve" | "reject"): Promise<void> {
    if (!key) return;
    setBusy(true);
    setError(null);
    try {
      await api(path, {
        method: "POST",
        headers: { "x-admin-key": key },
        json: { decision },
      });
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function saveKey(): void {
    localStorage.setItem(KEY_STORAGE, key);
    void load();
  }

  return (
    <Shell>
      <PageHeader
        title="Review queue"
        description="Manual decisions for content Laya could not clear automatically. Every action is audited."
      />

      <div className="card-pad mb-6 flex flex-wrap items-end gap-3">
        <div className="min-w-[280px] flex-1">
          <label className="label">Operator key</label>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="ADMIN_API_KEY"
            className="input"
          />
        </div>
        <button onClick={saveKey} className="btn-primary" disabled={!key}>
          Load queue
        </button>
        <span className="text-xs text-neutral-500">
          Queue: {queue.campaigns.length} campaigns · {queue.variants.length} variants ·{" "}
          {queue.tasks.length} tasks · {queue.payouts.length} payouts
        </span>
      </div>

      {error && (
        <p className="mb-6 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Campaigns</h2>
        <Table head={["Campaign", "Copy", "Score", "Reasons", "Decision"]}>
          {queue.campaigns.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-3">
                <div className="font-medium text-neutral-900">{c.name}</div>
                <div className="text-xs text-neutral-500">{c.status}</div>
              </td>
              <td className="max-w-[320px] px-4 py-3">
                <div className="font-medium">{c.headline}</div>
                <div className="text-xs text-neutral-500">{c.bodyText}</div>
                <a className="text-xs text-accent" href={c.targetUrl} target="_blank" rel="noreferrer">
                  {c.targetUrl}
                </a>
              </td>
              <td className="tabular px-4 py-3">{c.moderationScore ?? "—"}</td>
              <td className="max-w-[220px] px-4 py-3 text-xs text-neutral-500">
                {c.moderationReasons.join(", ") || "—"}
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-2">
                  <button
                    className="btn-primary text-xs"
                    disabled={busy}
                    onClick={() => review(`/admin/campaigns/${c.id}/review`, "approve")}
                  >
                    Approve
                  </button>
                  <button
                    className="btn-outline text-xs"
                    disabled={busy}
                    onClick={() => review(`/admin/campaigns/${c.id}/review`, "reject")}
                  >
                    Reject
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {queue.campaigns.length === 0 && (
            <tr>
              <td colSpan={5}>
                <Empty title="No campaigns waiting" />
              </td>
            </tr>
          )}
        </Table>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">A/B variants</h2>
        <Table head={["Campaign", "Variant", "Headline", "Score", "Decision"]}>
          {queue.variants.map((v) => (
            <tr key={v.id}>
              <td className="px-4 py-3 font-mono text-xs">{v.campaignId.slice(0, 8)}</td>
              <td className="px-4 py-3">{v.label}</td>
              <td className="px-4 py-3">
                <div className="font-medium">{v.headline}</div>
                <div className="text-xs text-neutral-500">{v.bodyText}</div>
              </td>
              <td className="tabular px-4 py-3">{v.moderationScore ?? "—"}</td>
              <td className="px-4 py-3">
                <div className="flex gap-2">
                  <button
                    className="btn-primary text-xs"
                    disabled={busy}
                    onClick={() => review(`/admin/variants/${v.id}/review`, "approve")}
                  >
                    Approve
                  </button>
                  <button
                    className="btn-outline text-xs"
                    disabled={busy}
                    onClick={() => review(`/admin/variants/${v.id}/review`, "reject")}
                  >
                    Reject
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {queue.variants.length === 0 && (
            <tr>
              <td colSpan={5}>
                <Empty title="No variants waiting" />
              </td>
            </tr>
          )}
        </Table>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Task proofs</h2>
        <Table head={["User", "Task", "Post", "Score", "Decision"]}>
          {queue.tasks.map((t) => (
            <tr key={t.id}>
              <td className="px-4 py-3 text-sm">{t.email ?? t.userId.slice(0, 8)}</td>
              <td className="px-4 py-3 capitalize">{t.taskType}</td>
              <td className="max-w-[280px] px-4 py-3">
                <a className="truncate text-accent" href={t.postUrl} target="_blank" rel="noreferrer">
                  {t.postUrl}
                </a>
                <div className="truncate font-mono text-[11px] text-neutral-400">{t.screenshotKey}</div>
              </td>
              <td className="tabular px-4 py-3">{t.moderationScore ?? "—"}</td>
              <td className="px-4 py-3">
                <div className="flex gap-2">
                  <button
                    className="btn-primary text-xs"
                    disabled={busy}
                    onClick={() => review(`/admin/tasks/${t.id}/review`, "approve")}
                  >
                    Approve
                  </button>
                  <button
                    className="btn-outline text-xs"
                    disabled={busy}
                    onClick={() => review(`/admin/tasks/${t.id}/review`, "reject")}
                  >
                    Reject
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {queue.tasks.length === 0 && (
            <tr>
              <td colSpan={5}>
                <Empty title="No task proofs waiting" />
              </td>
            </tr>
          )}
        </Table>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Payouts</h2>
        <Table head={["User", "Amount", "Destination", "Trust", "Status", "Decision"]}>
          {queue.payouts.map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-3 text-sm">{p.email ?? p.userId.slice(0, 8)}</td>
              <td className="tabular px-4 py-3">${(Number(p.amountMicro) / 1_000_000).toFixed(2)}</td>
              <td className="max-w-[220px] truncate px-4 py-3">{p.address ?? "—"}</td>
              <td className="tabular px-4 py-3">{p.trustScoreAtRequest ?? "—"}</td>
              <td className="px-4 py-3">
                <Badge tone={p.status === "frozen" ? "bad" : "warn"}>{p.status}</Badge>
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-2">
                  <button
                    className="btn-primary text-xs"
                    disabled={busy}
                    onClick={() => review(`/admin/payouts/${p.id}/review`, "approve")}
                  >
                    Approve
                  </button>
                  <button
                    className="btn-outline text-xs"
                    disabled={busy}
                    onClick={() => review(`/admin/payouts/${p.id}/review`, "reject")}
                  >
                    Reject
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {queue.payouts.length === 0 && (
            <tr>
              <td colSpan={6}>
                <Empty title="No payouts waiting" />
              </td>
            </tr>
          )}
        </Table>
      </section>
    </Shell>
  );
}
