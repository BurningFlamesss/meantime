import type { UserBalance } from "@meantime/shared";
// Import the leaf module: the shared barrel would pull zod/db code into the
// popup bundle just to read three pacing numbers.
import { PACING } from "@meantime/shared/constants";
import { WEB_BASE, apiFetch, getApiBase, setApiBase } from "../../lib/api-client";
import { authenticate, signOut, type AuthMode } from "../../lib/session";
import {
  DEFAULT_AD_REQUEST_LIMIT,
  getSettings,
  PAUSE_UNTIL_RESTART,
  pauseState,
  saveSettings,
  STORAGE_KEYS,
  storageGet,
  storageSet,
  type AdRequestLimit,
  type ExtensionSettings,
  type Identity,
  type PacingSnapshot,
  type PromptCounter,
} from "../../lib/storage";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing popup element: ${id}`);
  return node as T;
}

async function init(): Promise<void> {
  let settings = await getSettings();
  let authMode: AuthMode = "login";

  const authView = el<HTMLElement>("auth-view");
  const appView = el<HTMLElement>("app-view");
  const authForm = el<HTMLFormElement>("auth-form");
  const authEmail = el<HTMLInputElement>("auth-email");
  const authPassword = el<HTMLInputElement>("auth-password");
  const authHint = el<HTMLElement>("auth-hint");
  const authError = el<HTMLElement>("auth-error");
  const authSubmit = el<HTMLButtonElement>("auth-submit");
  const authToggle = el<HTMLButtonElement>("auth-toggle");
  const apiBase = el<HTMLInputElement>("api-base");
  const saveServer = el<HTMLButtonElement>("save-server");
  const serverNote = el<HTMLElement>("server-note");
  const introView = el<HTMLElement>("intro-view");
  const introDismiss = el<HTMLButtonElement>("intro-dismiss");
  const accountEmail = el<HTMLElement>("account-email");
  const signOutButton = el<HTMLButtonElement>("sign-out");

  const enabled = el<HTMLInputElement>("enabled");
  const placement = el<HTMLSelectElement>("placement");
  const maxDuration = el<HTMLInputElement>("max-duration");
  const maxDurationLabel = el<HTMLElement>("max-duration-label");
  const theme = el<HTMLSelectElement>("theme");
  const pauseBanner = el<HTMLElement>("pause-banner");
  const pauseDetail = el<HTMLElement>("pause-detail");
  const pauseResume = el<HTMLButtonElement>("pause-resume");
  const pauseDuration = el<HTMLSelectElement>("pause-duration");
  const pauseApply = el<HTMLButtonElement>("pause-apply");
  const displayModeRadios = Array.from(
    document.querySelectorAll<HTMLInputElement>("input[name='displayMode']"),
  );
  const statBalance = el<HTMLElement>("stat-balance");
  const statCache = el<HTMLElement>("stat-cache");
  const statPending = el<HTMLElement>("stat-pending");
  const rateLimitBox = el<HTMLElement>("rate-limit");
  const rateLimitLabel = el<HTMLElement>("rate-limit-label");
  const rateLimitValue = el<HTMLElement>("rate-limit-value");
  const rateTrack = el<HTMLElement>("rate-track");
  const rateFill = el<HTMLElement>("rate-fill");
  const rateDetail = el<HTMLElement>("rate-detail");
  const syncNow = el<HTMLButtonElement>("sync-now");
  let signedIn = false;

  apiBase.value = await getApiBase();

  function renderPause(): void {
    const state = pauseState(settings);
    enabled.checked = settings.enabled;
    pauseBanner.hidden = !state.paused;
    if (!state.paused) return;
    pauseDetail.textContent = state.untilRestart
      ? "No ads will show until you restart the browser."
      : state.indefinite
        ? "No ads will show and nothing new will be earned."
        : `Resumes in ~${Math.max(
            1,
            Math.ceil((state.resumesAt - Date.now()) / 60_000),
          )} min.`;
  }

  /**
   * Ad-only capacity meter. Local prompt pacing and server 429s both land here,
   * so "nothing is happening" is distinguishable from "the ad limit is spent".
   * The AI site itself is never throttled by MeanTime.
   */
  async function renderRateLimit(): Promise<void> {
    if (!signedIn) {
      rateLimitBox.hidden = true;
      return;
    }
    rateLimitBox.hidden = false;

    const now = Date.now();
    const [limit, pacing, counter] = await Promise.all([
      storageGet<AdRequestLimit>(STORAGE_KEYS.AD_REQUEST_LIMIT, DEFAULT_AD_REQUEST_LIMIT),
      storageGet<PacingSnapshot | null>(STORAGE_KEYS.PACING_STATE, null),
      storageGet<PromptCounter>(STORAGE_KEYS.AD_COUNTER, { windowStart: now, count: 0 }),
    ]);

    const counterLive = now - counter.windowStart < PACING.WINDOW_SECONDS * 1_000;
    const adsShown = counterLive ? counter.count : 0;
    const pacingFresh = !!pacing && now - pacing.updatedAt < PACING.WINDOW_SECONDS * 1_000;

    let percent = Math.min(100, Math.round((adsShown / PACING.TIER2_MAX_PER_HOUR) * 100));
    let severity: "ok" | "warn" | "limited" = "ok";
    let label = "Ad capacity";
    let value = `${Math.max(0, PACING.TIER1_MAX_PER_HOUR - adsShown)} full-speed ads left`;
    let detail = "Only ad requests are limited — your AI chats are never throttled.";
    let resumesAt = 0;

    if (limit.limitedUntil > now) {
      severity = "limited";
      percent = 100;
      label = "Ad rate limit exhausted";
      resumesAt = limit.limitedUntil;
      detail = "The server paused ad requests. Your AI chats are unaffected.";
    } else if (pacingFresh && pacing.tier === 3) {
      severity = "limited";
      percent = 100;
      label = "Ad rate limit exhausted";
      resumesAt = pacing.updatedAt + PACING.WINDOW_SECONDS * 1_000;
      detail = "Ads are paused for this hour. Your AI chats are unaffected.";
    } else if (adsShown >= PACING.TIER2_MAX_PER_HOUR) {
      severity = "limited";
      percent = 100;
      label = "Ad rate limit exhausted";
      resumesAt = counter.windowStart + PACING.WINDOW_SECONDS * 1_000;
      detail = "Hourly ad limit reached. Your AI chats are unaffected.";
    } else if (adsShown >= PACING.TIER1_MAX_PER_HOUR || (pacingFresh && pacing.tier === 2)) {
      severity = "warn";
      percent = Math.max(
        percent,
        Math.round((PACING.TIER1_MAX_PER_HOUR / PACING.TIER2_MAX_PER_HOUR) * 100),
      );
      label = "Ad rate limit: throttled";
      value = "Every 3rd ad";
      detail = "High ad volume — ads are throttled, not your AI. Chats are unaffected.";
    }

    if (resumesAt > now) {
      value = `Resumes in ~${Math.max(1, Math.ceil((resumesAt - now) / 60_000))} min`;
    }

    rateLimitLabel.textContent = label;
    rateLimitValue.textContent = value;
    rateDetail.textContent = detail;
    rateFill.style.width = `${percent}%`;
    rateTrack.setAttribute("aria-valuenow", String(percent));
    rateLimitBox.classList.toggle("warn", severity === "warn");
    rateLimitBox.classList.toggle("limited", severity === "limited");
  }

  function setAuthMode(mode: AuthMode): void {
    authMode = mode;
    const registering = mode === "register";
    authSubmit.textContent = registering ? "Create account" : "Sign in";
    authToggle.textContent = registering
      ? "Already have an account? Sign in"
      : "New here? Create an account";
    authHint.hidden = !registering;
    authPassword.autocomplete = registering ? "new-password" : "current-password";
    authPassword.minLength = registering ? 10 : 1;
    authError.hidden = true;
  }

  async function loadStatus(): Promise<void> {
    try {
      const status = (await chrome.runtime.sendMessage({ type: "cache_status" })) as {
        size: number;
        pending: number;
      } | null;
      statCache.textContent = status ? String(status.size) : "–";
      statPending.textContent = status ? String(status.pending) : "–";
    } catch {
      statCache.textContent = "–";
      statPending.textContent = "–";
    }
  }

  async function loadBalance(): Promise<void> {
    try {
      const balance = await apiFetch<UserBalance>("/me/balance");
      statBalance.textContent = `$${(balance.availableMicro / 1_000_000).toFixed(2)}`;
    } catch {
      statBalance.textContent = "–";
    }
  }

  async function renderSession(): Promise<void> {
    const identity = await storageGet<Identity | null>(STORAGE_KEYS.IDENTITY, null);
    signedIn = !!identity;
    authView.hidden = signedIn;
    appView.hidden = !signedIn;
    if (!identity) {
      statBalance.textContent = "–";
      statCache.textContent = "–";
      statPending.textContent = "–";
      rateLimitBox.hidden = true;
      return;
    }
    accountEmail.textContent = identity.email ?? identity.userId.slice(0, 8);
    void loadStatus();
    void loadBalance();
    void renderRateLimit();
    void chrome.runtime.sendMessage({ type: "prefetch_now" }).then(() => loadStatus()).catch(() => undefined);
  }

  authToggle.addEventListener("click", () => {
    setAuthMode(authMode === "login" ? "register" : "login");
  });

  saveServer.addEventListener("click", async () => {
    serverNote.textContent = "";
    try {
      await setApiBase(apiBase.value);
      apiBase.value = await getApiBase();
      serverNote.textContent = "Saved.";
    } catch (err) {
      serverNote.textContent = err instanceof Error ? err.message : "Could not save that URL.";
    }
  });

  authForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitAuth();
  });

  async function submitAuth(): Promise<void> {
    authError.hidden = true;
    const email = authEmail.value.trim();
    const password = authPassword.value;
    if (!email) {
      authError.textContent = "Enter your email.";
      authError.hidden = false;
      return;
    }
    if (authMode === "register" && password.length < 10) {
      authError.textContent = "Use a password of at least 10 characters.";
      authError.hidden = false;
      return;
    }
    if (!password) {
      authError.textContent = "Enter your password.";
      authError.hidden = false;
      return;
    }

    authSubmit.disabled = true;
    try {
      await setApiBase(apiBase.value);
      await authenticate(authMode, email, password);
      authPassword.value = "";
      await chrome.runtime.sendMessage({ type: "prefetch_now" }).catch(() => undefined);
      await renderSession();
    } catch (err) {
      authError.textContent =
        err instanceof Error ? err.message : "Could not sign in. Try again.";
      authError.hidden = false;
    } finally {
      authSubmit.disabled = false;
    }
  }

  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    try {
      // Settle already-watched impressions while the session is still valid.
      await chrome.runtime.sendMessage({ type: "flush_now" }).catch(() => undefined);
      await signOut();
      await renderSession();
    } finally {
      signOutButton.disabled = false;
    }
  });

  enabled.checked = settings.enabled;
  placement.value = settings.placement;
  theme.value = settings.theme ?? "auto";
  maxDuration.value = String(settings.maxAdDurationSec ?? 15);
  maxDurationLabel.textContent = `${settings.maxAdDurationSec ?? 15}s`;
  for (const radio of displayModeRadios) {
    radio.checked = radio.value === settings.displayMode;
    radio.addEventListener("change", async () => {
      if (!radio.checked) return;
      settings = { ...settings, displayMode: radio.value as ExtensionSettings["displayMode"] };
      await saveSettings({ displayMode: settings.displayMode });
    });
  }

  enabled.addEventListener("change", async () => {
    settings = enabled.checked
      ? { ...settings, enabled: true, snoozedUntil: 0 }
      : { ...settings, enabled: false };
    await saveSettings({ enabled: settings.enabled, snoozedUntil: settings.snoozedUntil });
    renderPause();
    if (settings.enabled) {
      void chrome.runtime.sendMessage({ type: "prefetch_now" }).then(() => loadStatus()).catch(() => undefined);
    }
  });

  pauseResume.addEventListener("click", async () => {
    settings = { ...settings, enabled: true, snoozedUntil: 0 };
    await saveSettings({ enabled: true, snoozedUntil: 0 });
    renderPause();
    void chrome.runtime.sendMessage({ type: "prefetch_now" }).then(() => loadStatus()).catch(() => undefined);
  });

  pauseApply.addEventListener("click", async () => {
    const choice = pauseDuration.value;
    const snoozedUntil =
      choice === "restart"
        ? PAUSE_UNTIL_RESTART
        : choice === "indefinite"
          ? Number.MAX_SAFE_INTEGER
          : Date.now() + Number(choice) * 60_000;
    settings = { ...settings, enabled: true, snoozedUntil };
    await saveSettings({ enabled: true, snoozedUntil });
    renderPause();
  });

  placement.addEventListener("change", async () => {
    settings = { ...settings, placement: placement.value as ExtensionSettings["placement"] };
    await saveSettings({ placement: settings.placement });
  });

  maxDuration.addEventListener("input", () => {
    maxDurationLabel.textContent = `${maxDuration.value}s`;
  });

  maxDuration.addEventListener("change", async () => {
    const val = Math.max(2, Math.min(15, Number(maxDuration.value)));
    settings = { ...settings, maxAdDurationSec: val };
    await saveSettings({ maxAdDurationSec: val });
    void chrome.runtime.sendMessage({ type: "prefetch_now" }).then(() => loadStatus()).catch(() => undefined);
  });

  theme.addEventListener("change", async () => {
    settings = { ...settings, theme: theme.value as ExtensionSettings["theme"] };
    await saveSettings({ theme: settings.theme });
  });

  introView.hidden = await storageGet<boolean>(STORAGE_KEYS.FIRST_RUN_SEEN, false);
  introDismiss.addEventListener("click", () => {
    introView.hidden = true;
    // Show it once per install; the popup stays the place to change settings.
    void storageSet(STORAGE_KEYS.FIRST_RUN_SEEN, true);
  });

  renderPause();
  setAuthMode("login");
  await renderSession();

  // A pause started in the in-page widget (or a timer running out) must show
  // up here without reopening the popup.
  setInterval(renderPause, 30_000);
  // Keep the countdown/bar live while the popup is open.
  setInterval(() => void renderRateLimit(), 1_000);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEYS.IDENTITY]) void renderSession();
    if (
      changes[STORAGE_KEYS.AD_COUNTER] ||
      changes[STORAGE_KEYS.PACING_STATE] ||
      changes[STORAGE_KEYS.AD_REQUEST_LIMIT]
    ) {
      void renderRateLimit();
    }
    if (changes[STORAGE_KEYS.SETTINGS]) {
      void getSettings().then((next) => {
        settings = next;
        placement.value = settings.placement;
        theme.value = settings.theme ?? "auto";
        maxDuration.value = String(settings.maxAdDurationSec ?? 15);
        maxDurationLabel.textContent = `${settings.maxAdDurationSec ?? 15}s`;
        for (const radio of displayModeRadios) {
          radio.checked = radio.value === settings.displayMode;
        }
        renderPause();
    if (settings.enabled) {
      void chrome.runtime.sendMessage({ type: "prefetch_now" }).then(() => loadStatus()).catch(() => undefined);
    }
      });
    }
  });

  syncNow.addEventListener("click", async () => {
    syncNow.disabled = true;
    syncNow.textContent = "Syncing…";
    try {
      await chrome.runtime.sendMessage({ type: "flush_now" });
      await loadStatus();
      await loadBalance();
      syncNow.textContent = "✓ Synced";
      setTimeout(() => {
        syncNow.textContent = "↻ Sync pending now";
        syncNow.disabled = false;
      }, 1500);
    } catch {
      syncNow.textContent = "Sync failed";
      setTimeout(() => {
        syncNow.textContent = "↻ Sync pending now";
        syncNow.disabled = false;
      }, 2000);
    }
  });

  el<HTMLButtonElement>("open-dashboard").addEventListener("click", () => {
    void chrome.tabs.create({ url: `${WEB_BASE}/dashboard` });
  });
  el<HTMLButtonElement>("open-dashboard-link").addEventListener("click", () => {
    void chrome.tabs.create({ url: `${WEB_BASE}/dashboard` });
  });
  el<HTMLButtonElement>("open-site").addEventListener("click", () => {
    void chrome.tabs.create({ url: WEB_BASE });
  });
  el<HTMLButtonElement>("open-privacy").addEventListener("click", () => {
    void chrome.tabs.create({ url: `${WEB_BASE}/privacy` });
  });
  el<HTMLButtonElement>("open-terms").addEventListener("click", () => {
    void chrome.tabs.create({ url: `${WEB_BASE}/terms` });
  });
}

void init();
