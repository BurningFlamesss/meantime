import { getApiBase } from "./api-client";
import { STORAGE_KEYS, storageGet, storageSet, uuidv4, type Identity } from "./storage";

const INSTALL_ID_KEY = "install_id";

/** Local SHA-256 so the popup does not pull the whole shared package. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type AuthMode = "login" | "register";

interface AuthResponse {
  userId: string;
  deviceId: string | null;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: number;
}

/**
 * A stable, random per-install id. It is the only device signal sent at auth
 * time: no canvas/WebGL fingerprinting, no hardware identifiers. The server
 * hashes the derived fingerprint and stores only that hash.
 */
async function installId(): Promise<string> {
  let id = await storageGet<string | null>(INSTALL_ID_KEY, null);
  if (!id) {
    id = uuidv4();
    await storageSet(INSTALL_ID_KEY, id);
  }
  return id;
}

function authErrorMessage(status: number, body: string): string {
  let code = "";
  try {
    code = (JSON.parse(body) as { error?: string }).error ?? "";
  } catch {
    // Non-JSON error body; fall back to the status.
  }
  if (status === 409 || code === "email_taken") {
    return "That email already has an account. Sign in instead.";
  }
  if (status === 401 || code === "invalid_credentials") {
    return "Email or password is incorrect.";
  }
  if (status === 429) return "Too many attempts. Try again in a few minutes.";
  if (status === 400 || code === "validation_failed") {
    return "Check your email and use a password of at least 10 characters.";
  }
  return "Could not reach the server. Check the server URL and try again.";
}

export async function authenticate(
  mode: AuthMode,
  email: string,
  password: string,
): Promise<Identity> {
  const base = await getApiBase();
  const deviceId = await installId();
  const fingerprintHash = await sha256Hex(`mt-install:${deviceId}`);

  const res = await fetch(`${base}/auth/${mode}`, {
    method: "POST",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      password,
      deviceId,
      fingerprintHash,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(authErrorMessage(res.status, body));
  }

  const data = (await res.json()) as AuthResponse;
  if (!data.accessToken || !data.refreshToken) {
    throw new Error("The server returned an incomplete session. Try again.");
  }
  const identity: Identity = {
    userId: data.userId,
    deviceId: data.deviceId ?? deviceId,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    tokenExpiresAt: data.refreshExpiresAt,
    email: email.trim().toLowerCase(),
  };
  await storageSet(STORAGE_KEYS.IDENTITY, identity);
  return identity;
}

/** Revoke the session server-side, then remove it locally. */
export async function signOut(): Promise<void> {
  const identity = await storageGet<Identity | null>(STORAGE_KEYS.IDENTITY, null);
  if (identity?.refreshToken) {
    try {
      const base = await getApiBase();
      await fetch(`${base}/auth/logout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: identity.refreshToken }),
      });
    } catch {
      // Offline logout still clears local state.
    }
  }
  // Drop per-account ad state too: a signed-out install or a different account
  // must not inherit the previous user's cached ads or frequency history.
  await chrome.storage.local.remove([
    STORAGE_KEYS.IDENTITY,
    STORAGE_KEYS.AD_CACHE,
    STORAGE_KEYS.IMPRESSION_HISTORY,
    STORAGE_KEYS.PROMPT_COUNTER,
  ]);
}
