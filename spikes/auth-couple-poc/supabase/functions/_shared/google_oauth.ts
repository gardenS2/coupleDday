import { createClient, type User } from "npm:@supabase/supabase-js@2";

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const APP_CALLBACK = "coupledday://auth/google-calendar-callback";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("server_not_configured");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function authenticatedUser(req: Request, admin = adminClient()): Promise<User> {
  const authorization = req.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) throw new Error("unauthorized");
  const { data, error } = await admin.auth.getUser(match[1]);
  if (error || !data.user) throw new Error("unauthorized");
  return data.user;
}

export async function requireCoupleMember(
  admin: ReturnType<typeof adminClient>,
  coupleId: string,
  userId: string,
) {
  const { data, error } = await admin
    .from("couple_members")
    .select("couple_id")
    .eq("couple_id", coupleId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("membership_check_failed");
  if (!data) throw new Error("membership_required");
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export function randomBase64Url(size = 32) {
  const value = new Uint8Array(size);
  crypto.getRandomValues(value);
  return base64Url(value);
}

export async function sha256Base64Url(value: string) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

export async function sha256Hex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hexBytea(value: string) {
  return `\\x${value}`;
}

export function byteaHex(value: unknown) {
  if (typeof value !== "string") return "";
  return value.startsWith("\\x") ? value.slice(2) : value;
}

export function tokenEncryptionConfig() {
  const key = Deno.env.get("GC_GOOGLE_TOKEN_ENCRYPTION_KEY");
  const keyVersion = Deno.env.get("GC_GOOGLE_TOKEN_ENCRYPTION_KEY_VERSION");
  if (!key || !keyVersion) return null;
  let rawKey: Uint8Array;
  try {
    const normalized = key.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    rawKey = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
  if (rawKey.length !== 32 || keyVersion.length > 64) return null;
  return { rawKey, keyVersion };
}

export function googleConfig() {
  const clientId = Deno.env.get("GC_GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GC_GOOGLE_CLIENT_SECRET");
  const url = Deno.env.get("SUPABASE_URL");
  const encryption = tokenEncryptionConfig();
  if (!clientId || !clientSecret || !url || !encryption) return null;
  const redirectUri = `${url.replace(/\/$/, "")}/functions/v1/google-calendar-oauth-callback`;
  return { clientId, clientSecret, ...encryption, redirectUri };
}

type TokenBinding = {
  connectionId: string;
  coupleId: string;
  ownerUserId: string;
  googleSub: string;
  keyVersion: string;
};

function tokenAdditionalData(binding: TokenBinding) {
  return new TextEncoder().encode([
    "coupledday-google-token-v1",
    binding.connectionId,
    binding.coupleId,
    binding.ownerUserId,
    binding.googleSub,
    binding.keyVersion,
  ].join(":"));
}

export async function encryptRefreshToken(token: string, rawKey: Uint8Array, binding: TokenBinding) {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(rawKey).buffer, "AES-GCM", false, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: tokenAdditionalData(binding) }, key, new TextEncoder().encode(token)));
  return { ciphertextHex: [...ciphertext].map((byte) => byte.toString(16).padStart(2, "0")).join(""), nonceHex: [...nonce].map((byte) => byte.toString(16).padStart(2, "0")).join("") };
}

export async function decryptRefreshToken(ciphertext: string, nonce: string, rawKey: Uint8Array, binding: TokenBinding) {
  const toBytes = (hex: string) => Uint8Array.from(hex.match(/.{2}/g) ?? [], (part) => Number.parseInt(part, 16));
  const key = await crypto.subtle.importKey("raw", new Uint8Array(rawKey).buffer, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toBytes(nonce), additionalData: tokenAdditionalData(binding) }, key, toBytes(ciphertext));
  return new TextDecoder().decode(plain);
}

export async function revokeGoogleToken(token: string) {
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  if (response.status === 400) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    if (body?.error === "invalid_token") return;
  }
  if (!response.ok) throw new Error("google_revoke_failed");
}

export async function refreshGoogleAccessToken(connectionId: string) {
  const config = googleConfig();
  if (!config) throw new Error("server_not_configured");
  const admin = adminClient();
  const { data: connection, error: connectionError } = await admin
    .from("google_calendar_connections")
    .select("id,couple_id,owner_user_id,status,authorization_epoch")
    .eq("id", connectionId)
    .maybeSingle();
  if (connectionError || !connection || connection.status !== "active" || !connection.owner_user_id) {
    throw new Error("connection_not_active");
  }
  const { data: credential, error: credentialError } = await admin
    .from("google_calendar_credentials")
    .select("owner_user_id,google_sub,credential_status,refresh_token_ciphertext,encryption_nonce,encryption_key_version,token_updated_at")
    .eq("connection_id", connectionId)
    .maybeSingle();
  if (credentialError || !credential || credential.owner_user_id !== connection.owner_user_id ||
    credential.credential_status !== "active" || !credential.refresh_token_ciphertext ||
    !credential.encryption_nonce || credential.encryption_key_version !== config.keyVersion) {
    throw new Error("credential_not_active");
  }
  const refreshToken = await decryptRefreshToken(
    byteaHex(credential.refresh_token_ciphertext),
    byteaHex(credential.encryption_nonce),
    config.rawKey,
    {
      connectionId: connection.id,
      coupleId: connection.couple_id,
      ownerUserId: credential.owner_user_id,
      googleSub: credential.google_sub,
      keyVersion: credential.encryption_key_version,
    },
  );
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!response.ok) {
    const providerError = response.status === 400
      ? await response.json().catch(() => null) as { error?: string } | null
      : null;
    // Do not expose Google error bodies; fence only credentials Google says were invalidated.
    if (providerError?.error === "invalid_grant") {
      const { error: reauthError } = await admin.rpc("gc02_mark_google_reauth_required", {
        p_connection_id: connection.id,
        p_couple_id: connection.couple_id,
        p_owner_user_id: connection.owner_user_id,
        p_authorization_epoch: connection.authorization_epoch,
        p_expected_token_updated_at: credential.token_updated_at,
      });
      if (reauthError) throw new Error("google_reauth_state_update_failed");
    }
    throw new Error("google_refresh_failed");
  }
  const tokens = await response.json() as { access_token?: string; expires_in?: number; refresh_token?: string };
  if (!tokens.access_token || !Number.isFinite(tokens.expires_in)) throw new Error("google_refresh_invalid_response");
  const rotated = tokens.refresh_token
    ? await encryptRefreshToken(tokens.refresh_token, config.rawKey, {
      connectionId: connection.id,
      coupleId: connection.couple_id,
      ownerUserId: connection.owner_user_id,
      googleSub: credential.google_sub,
      keyVersion: config.keyVersion,
    })
    : null;
  const { error: recordError } = await admin.rpc("gc02_record_google_token_refresh", {
    p_connection_id: connection.id,
    p_couple_id: connection.couple_id,
    p_owner_user_id: connection.owner_user_id,
    p_authorization_epoch: connection.authorization_epoch,
    p_expected_token_updated_at: credential.token_updated_at,
    p_rotated_refresh_token_ciphertext: rotated ? hexBytea(rotated.ciphertextHex) : null,
    p_rotated_encryption_nonce: rotated ? hexBytea(rotated.nonceHex) : null,
    p_rotated_encryption_key_version: rotated ? config.keyVersion : null,
  });
  if (recordError) throw new Error("google_refresh_race");
  return { accessToken: tokens.access_token, expiresIn: tokens.expires_in };
}

export function appCallback(result: "connected" | "cancelled" | "failed" | "disconnected") {
  const url = new URL(APP_CALLBACK);
  url.searchParams.set("result", result);
  return Response.redirect(url, 302);
}

export function serviceUnavailable() {
  return json({ error: "google_oauth_not_configured" }, 503);
}
