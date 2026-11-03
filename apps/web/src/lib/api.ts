const API_BASE = "http://localhost:3001";

// Advertiser sessions use their own token so an advertiser sign-in never
// disturbs (or escalates) the signed-in viewer's user session.
const ADVERTISER_TOKEN_KEY = "mt_advertiser_token";

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

export function getAdvertiserToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ADVERTISER_TOKEN_KEY);
}

export function setAdvertiserToken(token: string): void {
  localStorage.setItem(ADVERTISER_TOKEN_KEY, token);
}

export function clearAdvertiserToken(): void {
  if (typeof window !== "undefined") localStorage.removeItem(ADVERTISER_TOKEN_KEY);
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
  const token = getAdvertiserToken();
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
