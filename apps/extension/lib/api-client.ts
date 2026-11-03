import type { Identity } from "./storage";
import { STORAGE_KEYS } from "./storage";

const DEFAULT_API_BASE = "https://api.meantime.example";
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

async function apiBase(): Promise<string> {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  return (stored[CONFIG_KEY] as ApiConfig | undefined)?.baseUrl ?? DEFAULT_API_BASE;
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
    };
    await storeIdentity(next);
    return next;
  } catch {
    return null;
  }
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
  const base = await apiBase();
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
  if (res.status === 401 && id?.refreshToken && path !== "/auth/refresh") {
    const next = await refreshIdentity(base, id);
    if (next) {
      id = next;
      res = await send(next.accessToken);
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
