import {
  adminClient,
  authenticatedUser,
  corsHeaders,
  googleConfig,
  isUuid,
  json,
  randomBase64Url,
  requireCoupleMember,
  sha256Base64Url,
  sha256Hex,
  hexBytea,
  GOOGLE_CALENDAR_SCOPE,
} from "../_shared/google_oauth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const config = googleConfig();
  if (!config) return json({ error: "google_oauth_not_configured" }, 503);

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

    const { data: rows, error: listError } = await admin
      .from("google_calendar_connections")
      .select("id,couple_id,calendar_id,owner_user_id,status,authorization_epoch,created_at")
      .eq("couple_id", body.coupleId)
      .order("created_at", { ascending: false });
    if (listError) throw new Error("connection_read_failed");
    let connection = (rows ?? []).find((row: {
      id: string;
      couple_id: string;
      calendar_id: string | null;
      owner_user_id: string | null;
      status: string;
      authorization_epoch: number;
      created_at: string;
    }) => !["disconnected", "revoked"].includes(row.status));

    if (connection && connection.owner_user_id !== user.id) {
      return json({ error: "connection_owner_required" }, 409);
    }
    if (connection && ["revocation_pending", "disconnected"].includes(connection.status)) {
      return json({ error: "revocation_must_finish_first" }, 409);
    }

    if (!connection) {
      const { data, error } = await admin
        .from("google_calendar_connections")
        .insert({ couple_id: body.coupleId, owner_user_id: user.id, status: "authorizing" })
        .select("id,couple_id,calendar_id,owner_user_id,status,authorization_epoch")
        .single();
      if (error || !data) {
        // A concurrent request can win the couple's live-connection unique index.
        return json({ error: "connection_start_conflict" }, 409);
      }
      connection = data;
    }

    const { data: existingCredential, error: credentialError } = await admin
      .from("google_calendar_credentials")
      .select("credential_status,owner_user_id")
      .eq("connection_id", connection.id)
      .maybeSingle();
    if (credentialError) throw new Error("credential_state_read_failed");
    if (existingCredential?.credential_status === "revocation_pending") {
      return json({ error: "revocation_must_finish_first" }, 409);
    }
    if (existingCredential && existingCredential.owner_user_id !== user.id) {
      return json({ error: "connection_owner_required" }, 409);
    }

    const state = randomBase64Url(32);
    const verifier = randomBase64Url(64);
    const challenge = await sha256Base64Url(verifier);
    const stateHash = await sha256Hex(state);
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

    await admin.from("google_calendar_oauth_sessions").delete().lt("expires_at", new Date().toISOString());
    const { error: clearError } = await admin
      .from("google_calendar_oauth_sessions")
      .delete()
      .eq("connection_id", connection.id);
    if (clearError) throw new Error("oauth_session_reset_failed");
    const { error: sessionError } = await admin.from("google_calendar_oauth_sessions").insert({
      connection_id: connection.id,
      couple_id: body.coupleId,
      user_id: user.id,
      authorization_epoch: connection.authorization_epoch,
      state_hash: hexBytea(stateHash),
      code_verifier: verifier,
      previous_connection_status: connection.status,
      expires_at: expiresAt,
    });
    if (sessionError) throw new Error("oauth_session_create_failed");

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", `openid email profile ${GOOGLE_CALENDAR_SCOPE}`);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return json({ authorizationUrl: url.toString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "request_failed";
    if (message === "unauthorized") return json({ error: message }, 401);
    if (message === "membership_required") return json({ error: message }, 403);
    return json({ error: "google_oauth_start_failed" }, 500);
  }
});
