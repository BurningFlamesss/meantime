const API_BASE = "http://localhost:3001";

// Advertiser sessions use their own token so an advertiser sign-in never
// disturbs (or escalates) the signed-in viewer's user session.
const ADVERTISER_SESSION_KEY = "mt_advertiser_session";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("mt_token");
}

export function setToken(token: string): void {
  localStorage.setItem("mt_token", token);
}

export function clearToken(): void {
  if (typeof window !== "undefined") localStorage.removeItem("mt_token");
}

export interface AdvertiserSession {
  accessToken: string;
  /** Rotating refresh token; the access token lives one hour. */
  refreshToken: string;
}

function readAdvertiserSession(): AdvertiserSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(ADVERTISER_SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AdvertiserSession>;
    if (!parsed.accessToken) return null;
    return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken ?? "" };
  } catch {
    return null;
  }
}

export function getAdvertiserToken(): string | null {
  return readAdvertiserSession()?.accessToken ?? null;
}

export function setAdvertiserSession(session: AdvertiserSession): void {
  localStorage.setItem(ADVERTISER_SESSION_KEY, JSON.stringify(session));
}

export function clearAdvertiserSession(): void {
  if (typeof window !== "undefined") localStorage.removeItem(ADVERTISER_SESSION_KEY);
}

/** Exchange the stored refresh token for a fresh one-token pair. */
async function rotateAdvertiserSession(): Promise<AdvertiserSession | null> {
  const current = readAdvertiserSession();
  if (!current?.refreshToken) return null;
  try {
    const res = await fetch(`${API_BASE}/advertiser/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<AdvertiserSession>;
    if (!data.accessToken || !data.refreshToken) return null;
    const next: AdvertiserSession = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    };
    setAdvertiserSession(next);
    return next;
  } catch {
    return null;
  }
}

/** Revoke the portal session server-side, then forget it locally. */
export async function revokeAdvertiserSession(): Promise<void> {
  const current = readAdvertiserSession();
  clearAdvertiserSession();
  if (!current?.refreshToken) return;
  try {
    await fetch(`${API_BASE}/advertiser/logout`, {
      method: "POST",
      headers: { "content-type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
  } catch {
    // Local sign-out already happened; a network blip must not block it.
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`${status}: ${body}`);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    body = JSON.stringify(init.json);
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text);
  }
  return (await res.json()) as T;
}

/** Portal calls under the advertiser token instead of the viewer token. */
export async function apiAsAdvertiser<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    body = JSON.stringify(init.json);
    headers.set("Content-Type", "application/json");
  }

  const send = (token: string | null): Promise<Response> => {
    const requestHeaders = new Headers(headers);
    if (token) requestHeaders.set("Authorization", `Bearer ${token}`);
    return fetch(`${API_BASE}${path}`, { ...init, headers: requestHeaders, body });
  };

  let res = await send(getAdvertiserToken());
  // Access tokens are short-lived; one rotation attempt keeps a working portal
  // session alive without asking the advertiser to sign in again.
  if (res.status === 401) {
    const next = await rotateAdvertiserSession();
    if (next) res = await send(next.accessToken);
    else clearAdvertiserSession();
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text);
  }
  return (await res.json()) as T;
}
