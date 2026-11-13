import { db } from "./supabase";
import * as Linking from "expo-linking";

export type GoogleCalendarConnectionStatus =
  | "authorizing"
  | "active"
  | "paused"
  | "reauth_required"
  | "permission_lost"
  | "error"
  | "recovery_review"
  | "disconnected"
  | "revocation_pending"
  | "revoked";

export type GoogleCalendarConnectionSummary = {
  status: GoogleCalendarConnectionStatus;
  owner_user_id: string | null;
  created_at: string;
  last_verified_at: string | null;
};

async function throwCalendarFunctionError(error: unknown): Promise<never> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context && typeof context === "object" && "json" in context && typeof context.json === "function") {
    let body: { error?: string } | null = null;
    try {
      body = await context.json() as { error?: string };
    } catch { /* Do not surface raw provider or gateway payloads to the app. */ }
    const messages: Record<string, string> = {
      google_oauth_not_configured: "Google Cloud 서버 설정이 아직 완료되지 않았어요.",
      connection_owner_required: "현재 Google 연결 담당자만 연결을 관리할 수 있어요.",
      revocation_must_finish_first: "이전 Google 권한 철회가 끝난 뒤 다시 연결해 주세요.",
      google_revocation_pending: "Google 권한 철회가 보류됐어요. 잠시 후 다시 시도해 주세요.",
      membership_required: "커플 연결을 확인한 뒤 다시 시도해 주세요.",
    };
    if (body?.error) throw new Error(messages[body.error] ?? "Google Calendar 요청을 완료하지 못했어요.");
  }
  throw new Error("Google Calendar 요청을 완료하지 못했어요.");
}

/** Reads only the couple-visible connection summary; credentials remain server-only. */
export async function getGoogleCalendarConnectionSummary(coupleId: string) {
  const result = await db()
    .from("google_calendar_connections")
    .select("status,owner_user_id,created_at,last_verified_at")
    .eq("couple_id", coupleId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data as GoogleCalendarConnectionSummary | null;
}

export async function startGoogleCalendarAuthorization(coupleId: string) {
  const { data, error } = await db().functions.invoke("google-calendar-oauth-start", {
    body: { coupleId },
  });
  if (error) await throwCalendarFunctionError(error);
  const authorizationUrl = (data as { authorizationUrl?: unknown } | null)?.authorizationUrl;
  if (typeof authorizationUrl !== "string" || !authorizationUrl.startsWith("https://accounts.google.com/")) {
    throw new Error("Google 인증 주소를 받지 못했어요.");
  }
  await Linking.openURL(authorizationUrl);
}

export async function disconnectGoogleCalendarAuthorization(coupleId: string) {
  const { data, error } = await db().functions.invoke("google-calendar-oauth-disconnect", {
    body: { coupleId },
  });
  if (error) await throwCalendarFunctionError(error);
  if ((data as { status?: unknown } | null)?.status !== "disconnected") {
    throw new Error("Google 권한 연결을 해제하지 못했어요.");
  }
}
