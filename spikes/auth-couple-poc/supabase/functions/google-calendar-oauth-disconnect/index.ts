import {
  adminClient,
  authenticatedUser,
  byteaHex,
  corsHeaders,
  decryptRefreshToken,
  isUuid,
  json,
  requireCoupleMember,
  revokeGoogleToken,
  tokenEncryptionConfig,
} from "../_shared/google_oauth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const admin = adminClient();
    const user = await authenticatedUser(req, admin);
    let body: { coupleId?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_request" }, 400);
    }
    if (!isUuid(body.coupleId)) return json({ error: "invalid_couple" }, 400);
    await requireCoupleMember(admin, body.coupleId, user.id);

    const { data: connection, error: connectionError } = await admin
      .rpc("gc02_begin_google_disconnect", { p_couple_id: body.coupleId, p_user_id: user.id })
      .maybeSingle();
    if (connectionError) {
      if (connectionError.code === "42501") return json({ error: "connection_owner_required" }, 403);
      throw new Error("disconnect_state_failed");
    }
    if (!connection) return json({ status: "disconnected" });

    const encryption = tokenEncryptionConfig();
    if (connection.refresh_token_ciphertext && connection.encryption_nonce && !encryption) {
      await admin.from("google_calendar_connections").update({ last_error_code: "encryption_key_unavailable" })
        .eq("id", connection.connection_id).eq("status", "revocation_pending");
      return json({ error: "google_revocation_pending" }, 503);
    }
    if (connection.refresh_token_ciphertext && connection.encryption_nonce && encryption) {
      try {
        const token = await decryptRefreshToken(
          byteaHex(connection.refresh_token_ciphertext),
          byteaHex(connection.encryption_nonce),
          encryption.rawKey,
          {
            connectionId: connection.connection_id,
            coupleId: connection.couple_id,
            ownerUserId: connection.credential_owner_user_id,
            googleSub: connection.google_sub,
            keyVersion: connection.encryption_key_version,
          },
        );
        await revokeGoogleToken(token);
      } catch {
        await admin.from("google_calendar_connections").update({
          last_error_code: "google_revoke_pending",
        }).eq("id", connection.connection_id).eq("status", "revocation_pending");
        return json({ error: "google_revocation_pending" }, 502);
      }
    }

    if (connection.credential_owner_user_id) {
      const { error } = await admin.from("google_calendar_credentials").update({
        credential_status: "revoked",
        refresh_token_ciphertext: null,
        encryption_nonce: null,
        encryption_key_version: null,
        token_updated_at: new Date().toISOString(),
      }).eq("connection_id", connection.connection_id).eq("credential_status", "revocation_pending");
      if (error) throw new Error("credential_scrub_failed");
    }
    const { error: finishError } = await admin
      .from("google_calendar_connections")
      .update({ status: "disconnected", last_error_code: null, paused_at: new Date().toISOString() })
      .eq("id", connection.connection_id).eq("status", "revocation_pending");
    if (finishError) throw new Error("disconnect_finalize_failed");
    return json({ status: "disconnected" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "request_failed";
    if (message === "unauthorized") return json({ error: message }, 401);
    if (message === "membership_required") return json({ error: message }, 403);
    return json({ error: "google_disconnect_failed" }, 500);
  }
});
