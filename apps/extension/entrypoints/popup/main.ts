import type { UserBalance } from "@meantime/shared";
import { WEB_BASE, apiFetch, getApiBase, setApiBase } from "../../lib/api-client";
import { authenticate, signOut, type AuthMode } from "../../lib/session";
import {
  getSettings,
  saveSettings,
  STORAGE_KEYS,
  storageGet,
  type ExtensionSettings,
  type Identity,
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
  const accountEmail = el<HTMLElement>("account-email");
  const signOutButton = el<HTMLButtonElement>("sign-out");

  const enabled = el<HTMLInputElement>("enabled");
  const placement = el<HTMLSelectElement>("placement");
  const snoozeState = el<HTMLElement>("snooze-state");
  const statBalance = el<HTMLElement>("stat-balance");
  const statCache = el<HTMLElement>("stat-cache");
  const statPending = el<HTMLElement>("stat-pending");

  apiBase.value = await getApiBase();

  function renderSnooze(): void {
    if (!settings.enabled) {
      snoozeState.textContent = "";
      return;
    }
    if (settings.snoozedUntil === Number.MAX_SAFE_INTEGER) {
      snoozeState.textContent = "Paused until you turn it back on.";
    } else if (settings.snoozedUntil > Date.now()) {
      const mins = Math.ceil((settings.snoozedUntil - Date.now()) / 60_000);
      snoozeState.textContent = `Paused — resumes in ~${mins} min.`;
    } else {
      snoozeState.textContent = "";
    }
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
    const signedIn = !!identity;
    authView.hidden = signedIn;
    appView.hidden = !signedIn;
    if (!identity) {
      statBalance.textContent = "–";
      statCache.textContent = "–";
      statPending.textContent = "–";
      return;
    }
    accountEmail.textContent = identity.email ?? identity.userId.slice(0, 8);
    void loadStatus();
    void loadBalance();
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
  for (const radio of document.querySelectorAll<HTMLInputElement>(
    "input[name='displayMode']",
  )) {
    radio.checked = radio.value === settings.displayMode;
    radio.addEventListener("change", async () => {
      if (!radio.checked) return;
      settings = { ...settings, displayMode: radio.value as ExtensionSettings["displayMode"] };
      await saveSettings({ displayMode: settings.displayMode });
    });
  }

  enabled.addEventListener("change", async () => {
    settings = {
      ...settings,
      enabled: enabled.checked,
      snoozedUntil: enabled.checked ? 0 : settings.snoozedUntil,
    };
    await saveSettings({ enabled: settings.enabled, snoozedUntil: settings.snoozedUntil });
    renderSnooze();
  });

  placement.addEventListener("change", async () => {
    settings = { ...settings, placement: placement.value as ExtensionSettings["placement"] };
    await saveSettings({ placement: settings.placement });
  });

  renderSnooze();
  setAuthMode("login");
  await renderSession();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEYS.IDENTITY]) void renderSession();
  });

  el<HTMLButtonElement>("open-dashboard").addEventListener("click", () => {
    void chrome.tabs.create({ url: `${WEB_BASE}/dashboard` });
  });
}

void init();
