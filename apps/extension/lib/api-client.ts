import type { Identity } from "./storage";
import { STORAGE_KEYS } from "./storage";

// WXT exposes `WXT_`-prefixed build env vars. Keep the cast local so the
// generated ImportMetaEnv type does not need a project-specific declaration.
const buildEnv = import.meta.env as unknown as Record<string, string | undefined>;

export const DEFAULT_API_BASE =
  buildEnv.WXT_API_BASE?.replace(/\/+$/, "") ?? "http://localhost:3001";
export const WEB_BASE =
  buildEnv.WXT_WEB_BASE?.replace(/\/+$/, "") ?? "http://localhost:3000";
const CONFIG_KEY = "api_config";

interface ApiConfig {
  baseUrl: string;
}

interface RefreshResponse {
  userId: string;
  deviceId: string | null;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: number;
}

export async function getApiBase(): Promise<string> {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  return (stored[CONFIG_KEY] as ApiConfig | undefined)?.baseUrl ?? DEFAULT_API_BASE;
}

export async function setApiBase(url: string): Promise<void> {
  const normalized = url.trim().replace(/\/+$/, "");
  if (!normalized) throw new Error("Server URL is required.");
  const parsed = new URL(normalized);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Server URL must start with http:// or https://.");
  }
  await chrome.storage.local.set({ [CONFIG_KEY]: { baseUrl: normalized } });
}

async function identity(): Promise<Identity | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.IDENTITY);
  return (stored[STORAGE_KEYS.IDENTITY] as Identity | undefined) ?? null;
}

async function storeIdentity(next: Identity): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.IDENTITY]: next });
}

/**
 * Rotate the refresh token. The server revokes the presented session, so a
 * concurrent or replayed refresh fails rather than silently extending a
 * stolen token. Returns null when refresh is impossible (offline, revoked).
 */
async function refreshIdentity(base: string, current: Identity): Promise<Identity | null> {
  if (!current.refreshToken) return null;
  try {
    const res = await fetch(`${base}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as RefreshResponse;
    if (!data.accessToken || !data.refreshToken) return null;
    const next: Identity = {
      userId: data.userId || current.userId,
      deviceId: data.deviceId ?? current.deviceId,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      tokenExpiresAt: data.refreshExpiresAt || current.tokenExpiresAt,
      email: current.email,
    };
    await storeIdentity(next);
    return next;
  } catch {
    return null;
  }
}

async function clearIdentity(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.IDENTITY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown; compress?: boolean } = {},
): Promise<T> {
  const base = await getApiBase();
  let id = await identity();

  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");

  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    const payload = JSON.stringify(init.json);
    if (init.compress && payload.length > 1024 && typeof CompressionStream !== "undefined") {
      const stream = new Blob([payload])
        .stream()
        .pipeThrough(new CompressionStream("deflate"));
      body = await new Response(stream).blob();
      headers.set("Content-Encoding", "deflate");
      headers.set("Content-Type", "application/json");
    } else {
      body = payload;
      headers.set("Content-Type", "application/json");
    }
  }

  const send = (token: string | undefined): Promise<Response> => {
    const requestHeaders = new Headers(headers);
    if (token) requestHeaders.set("Authorization", `Bearer ${token}`);
    return fetch(`${base}${path}`, { ...init, headers: requestHeaders, body });
  };

  let res = await send(id?.accessToken);
  if (res.status === 401 && path !== "/auth/refresh") {
    const next = id?.refreshToken ? await refreshIdentity(base, id) : null;
    if (next) {
      id = next;
      res = await send(next.accessToken);
    } else if (id) {
      // The server rejected the session and refresh could not recover it;
      // clear local state so the popup returns to sign-in instead of looping.
      await clearIdentity();
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
