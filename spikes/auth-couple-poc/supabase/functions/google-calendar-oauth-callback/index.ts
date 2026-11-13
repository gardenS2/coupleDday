import {
  adminClient,
  appCallback,
  byteaHex,
  encryptRefreshToken,
  googleConfig,
  GOOGLE_CALENDAR_SCOPE,
  hexBytea,
  requireCoupleMember,
  sha256Hex,
} from "../_shared/google_oauth.ts";

type OAuthSession = {
  id: string;
  connection_id: string;
  couple_id: string;
  user_id: string;
  authorization_epoch: number;
  code_verifier: string;
  previous_connection_status: string;
  expires_at: string;
};

function hasScope(scopes: string[], required: string) {
  return scopes.includes(required);
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return appCallback("failed");
  const config = googleConfig();
  if (!config) return appCallback("failed");
  const callbackUrl = new URL(req.url);
  const state = callbackUrl.searchParams.get("state");
  if (!state || state.length > 256) return appCallback("failed");

  let oauthSession: OAuthSession | null = null;
  const admin = adminClient();
  try {
    const stateHash = await sha256Hex(state);
    // DELETE ... RETURNING makes the state single-use even under concurrent callbacks.
    const { data, error } = await admin
      .from("google_calendar_oauth_sessions")
      .delete()
      .eq("state_hash", hexBytea(stateHash))
      .select("id,connection_id,couple_id,user_id,authorization_epoch,code_verifier,previous_connection_status,expires_at")
      .maybeSingle();
    if (error || !data) return appCallback("failed");
    oauthSession = data as OAuthSession;
    if (Date.parse(oauthSession.expires_at) <= Date.now()) return appCallback("failed");

    const { data: connection, error: connectionError } = await admin
      .from("google_calendar_connections")
      .select("id,couple_id,calendar_id,owner_user_id,status,authorization_epoch")
      .eq("id", oauthSession.connection_id)
      .eq("couple_id", oauthSession.couple_id)
      .maybeSingle();
    if (connectionError || !connection || connection.owner_user_id !== oauthSession.user_id ||
      connection.authorization_epoch !== oauthSession.authorization_epoch ||
      ["disconnected", "revoked", "revocation_pending"].includes(connection.status)) {
      return appCallback("failed");
    }
    await requireCoupleMember(admin, oauthSession.couple_id, oauthSession.user_id);

    const providerError = callbackUrl.searchParams.get("error");
    if (providerError) {
      await admin.from("google_calendar_connections").update({
        status: oauthSession.previous_connection_status === "authorizing" ? "error" : connection.status,
        last_error_code: providerError === "access_denied" ? "user_cancelled" : "provider_authorization_failed",
      }).eq("id", connection.id).eq("status", connection.status)
        .eq("authorization_epoch", oauthSession.authorization_epoch);
      return appCallback(providerError === "access_denied" ? "cancelled" : "failed");
    }

    const code = callbackUrl.searchParams.get("code");
    if (!code || code.length > 4096) return appCallback("failed");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
        code_verifier: oauthSession.code_verifier,
      }),
    });
    if (!tokenResponse.ok) {
      await admin.from("google_calendar_connections").update({
        status: oauthSession.previous_connection_status === "authorizing" ? "error" : connection.status,
        last_error_code: "code_exchange_failed",
      }).eq("id", connection.id).eq("status", connection.status)
        .eq("authorization_epoch", oauthSession.authorization_epoch);
      return appCallback("failed");
    }
    const tokens = await tokenResponse.json() as {
      access_token?: string;
      refresh_token?: string;
      scope?: string;
    };
    if (!tokens.access_token) return appCallback("failed");

    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userInfoResponse.ok) return appCallback("failed");
    const googleUser = await userInfoResponse.json() as { sub?: string };
    if (!googleUser.sub) return appCallback("failed");

    const grantedScopes = tokens.scope?.split(/\s+/).filter(Boolean) ?? [
      "openid", "email", "profile", GOOGLE_CALENDAR_SCOPE,
    ];
    if (!hasScope(grantedScopes, GOOGLE_CALENDAR_SCOPE)) {
      await admin.from("google_calendar_connections").update({
        status: "reauth_required",
        last_error_code: "calendar_scope_missing",
      }).eq("id", connection.id).eq("status", connection.status)
        .eq("authorization_epoch", oauthSession.authorization_epoch);
      return appCallback("failed");
    }

    const { data: priorCredential, error: priorError } = await admin
      .from("google_calendar_credentials")
      .select("owner_user_id,google_sub,refresh_token_ciphertext,encryption_nonce,encryption_key_version,credential_status")
      .eq("connection_id", connection.id)
      .maybeSingle();
    if (priorError) return appCallback("failed");
    if (priorCredential && priorCredential.google_sub !== googleUser.sub &&
      priorCredential.credential_status !== "revoked") {
      await admin.from("google_calendar_connections").update({
        status: "reauth_required",
        last_error_code: "google_account_change_requires_revocation",
      }).eq("id", connection.id).eq("status", connection.status)
        .eq("authorization_epoch", oauthSession.authorization_epoch);
      return appCallback("failed");
    }
    if (priorCredential?.owner_user_id && priorCredential.owner_user_id !== oauthSession.user_id &&
      priorCredential.credential_status !== "revoked") return appCallback("failed");

    let ciphertextHex: string;
    let nonceHex: string;
    if (tokens.refresh_token) {
      ({ ciphertextHex, nonceHex } = await encryptRefreshToken(tokens.refresh_token, config.rawKey, {
        connectionId: connection.id,
        coupleId: connection.couple_id,
        ownerUserId: oauthSession.user_id,
        googleSub: googleUser.sub,
        keyVersion: config.keyVersion,
      }));
    } else if (priorCredential?.google_sub === googleUser.sub &&
      priorCredential.owner_user_id === oauthSession.user_id &&
      priorCredential.refresh_token_ciphertext && priorCredential.encryption_nonce &&
      priorCredential.encryption_key_version === config.keyVersion &&
      ["active", "reauth_required"].includes(priorCredential.credential_status)) {
      // Google may omit a refresh token on later grants; preserve the same account's encrypted token.
      ciphertextHex = byteaHex(priorCredential.refresh_token_ciphertext);
      nonceHex = byteaHex(priorCredential.encryption_nonce);
    } else {
      await admin.from("google_calendar_connections").update({
        status: "reauth_required",
        last_error_code: "refresh_token_missing",
      }).eq("id", connection.id).eq("status", connection.status)
        .eq("authorization_epoch", oauthSession.authorization_epoch);
      return appCallback("failed");
    }

    const { error: credentialSaveError } = await admin.rpc("gc02_store_google_credential", {
      p_connection_id: connection.id,
      p_couple_id: connection.couple_id,
      p_owner_user_id: oauthSession.user_id,
      p_authorization_epoch: oauthSession.authorization_epoch,
      p_google_sub: googleUser.sub,
      p_refresh_token_ciphertext: hexBytea(ciphertextHex),
      p_encryption_nonce: hexBytea(nonceHex),
      p_encryption_key_version: config.keyVersion,
      p_granted_scopes: grantedScopes,
    });
    if (credentialSaveError) return appCallback("failed");
    return appCallback("connected");
  } catch {
    if (oauthSession) {
      await admin.from("google_calendar_connections").update({
        last_error_code: "oauth_callback_failed",
      }).eq("id", oauthSession.connection_id)
        .not("status", "in", "(disconnected,revoked,revocation_pending)");
    }
    return appCallback("failed");
  }
});
