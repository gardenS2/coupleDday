import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import * as Linking from "expo-linking";
import type { Session } from "@supabase/supabase-js";
import { supabase, db } from "./supabase";
export type Couple = { id: string; relationship_start: string };
export type MyProfile = { private_name: string; partner_name: string | null };
type State = {
  session: Session | null;
  couple: Couple | null;
  profile: MyProfile | null;
  count: number;
  eventsRevision: number;
  invalidateEvents: () => void;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  saveMyName: (name: string) => Promise<void>;
  saveRelationshipStart: (date: string) => Promise<void>;
  logout: () => Promise<void>;
  googleAuthNotice: string;
  linkGoogleIdentity: () => Promise<void>;
  unlinkGoogleIdentity: () => Promise<void>;
};
const Auth = createContext<State>(null!);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(!supabase),
    [couple, setCouple] = useState<Couple | null>(null),
    [profile, setProfile] = useState<MyProfile | null>(null),
    [eventsRevision, setEventsRevision] = useState(0),
    [count, setCount] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [googleAuthNotice, setGoogleAuthNotice] = useState("");
  const current = useRef(session);
  const generation = useRef(0);
  const handledAuthCodes = useRef(new Set<string>());
  const invalidateEvents = useCallback(() => {
    setEventsRevision((revision) => revision + 1);
  }, []);
  const refresh = useCallback(async () => {
    const run = ++generation.current;
    const user = current.current?.user.id;
    if (!supabase || !user) {
      setCouple(null);
      setProfile(null);
      setCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    setCouple(null);
    setProfile(null);
    setCount(0);
    try {
      const result = await supabase
        .from("couples")
        .select("id,relationship_start")
        .maybeSingle();
      if (result.error) throw result.error;
      const profileResult = await supabase
        .from("profiles")
        .select("private_name")
        .eq("user_id", user)
        .maybeSingle();
      if (profileResult.error) throw profileResult.error;
      let partnerName: string | null = null;
      if (result.data) {
        const partnerResult = await supabase.rpc("get_partner_name");
        if (!partnerResult.error && typeof partnerResult.data === "string")
          partnerName = partnerResult.data;
      }
      const members = result.data
        ? await supabase
            .from("couple_members")
            .select("user_id", { count: "exact", head: true })
            .eq("couple_id", result.data.id)
        : null;
      if (members?.error) throw members.error;
      if (run === generation.current && current.current?.user.id === user) {
        setCouple(result.data);
        setProfile(
          profileResult.data
            ? { ...profileResult.data, partner_name: partnerName }
            : null,
        );
        setCount(members?.count ?? 0);
      }
    } catch {
      if (run === generation.current) {
        setCouple(null);
        setProfile(null);
        setCount(0);
        setError("연결 상태를 확인하지 못했어요. 다시 시도해 주세요.");
      }
    } finally {
      if (run === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let alive = true,
      changed = false;
    const completeAuthCallback = async (url: string) => {
      if (!url.startsWith("coupledday://auth/callback")) return;
      const params = Linking.parse(url).queryParams ?? {};
      if (params.error || params.error_description) {
        setGoogleAuthNotice(
          "Google 연결을 취소했거나 완료하지 못했어요. 다시 시도할 수 있어요.",
        );
        return;
      }
      const code = params.code;
      if (typeof code !== "string" || handledAuthCodes.current.has(code))
        return;
      handledAuthCodes.current.add(code);
      if (handledAuthCodes.current.size > 8) {
        const oldest = handledAuthCodes.current.values().next().value;
        if (oldest) handledAuthCodes.current.delete(oldest);
      }
      try {
        const result = await client.auth.exchangeCodeForSession(code);
        if (result.error) {
          setGoogleAuthNotice(
            "인증 응답을 확인하지 못했어요. 만료된 연결일 수 있어 다시 시도해 주세요.",
          );
          return;
        }
      } catch {
        setGoogleAuthNotice(
          "인증을 완료하지 못했어요. 연결을 다시 시도해 주세요.",
        );
        return;
      }
      setGoogleAuthNotice("인증을 완료했어요.");
      await refresh();
    };
    const receive = (next: Session | null) => {
      current.current = next;
      setSession(next);
      setReady(true);
      setLoading(!!next);
      queueMicrotask(() => {
        if (alive) void refresh();
      });
    };
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      changed = true;
      if (alive) {
        receive(next);
      }
    });
    const linkSubscription = Linking.addEventListener("url", ({ url }) => {
      if (alive) void completeAuthCallback(url);
    });
    void Linking.getInitialURL().then((url) => {
      if (alive && url) void completeAuthCallback(url);
    }).catch(() => undefined);
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (alive && !changed) {
          receive(data.session);
          if (error) setError("저장된 로그인을 확인하지 못했어요.");
        }
      })
      .catch(() => {
        if (alive) {
          setReady(true);
          setError("로그인 복원에 실패했어요.");
        }
      });
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        supabase?.auth.startAutoRefresh();
        void refresh();
      } else supabase?.auth.stopAutoRefresh();
    });
    supabase.auth.startAutoRefresh();
    return () => {
      alive = false;
      data.subscription.unsubscribe();
      linkSubscription.remove();
      sub.remove();
      supabase?.auth.stopAutoRefresh();
    };
  }, [refresh]);
  async function logout() {
    generation.current++;
    setCouple(null);
    setProfile(null);
    setCount(0);
    const result = await db().auth.signOut({ scope: "local" });
    if (result.error) throw result.error;
    setSession(null);
  }
  const linkGoogleIdentity = useCallback(async () => {
    if (!supabase || !current.current?.user)
      throw new Error("Google 계정을 연결하려면 먼저 로그인해 주세요.");
    if (current.current.user.identities?.some((identity) => identity.provider === "google"))
      throw new Error("이미 Google 계정이 연결되어 있어요.");
    setGoogleAuthNotice("");
    const redirectTo = Linking.createURL("auth/callback", {
      scheme: "coupledday",
    });
    const { data, error } = await supabase.auth.linkIdentity({
      provider: "google",
      options: {
        redirectTo,
        scopes: "openid email profile",
        skipBrowserRedirect: true,
      },
    });
    if (error) throw error;
    if (!data.url) throw new Error("Google 연결 주소를 만들지 못했어요.");
    await Linking.openURL(data.url);
    setGoogleAuthNotice(
      "시스템 브라우저에서 Google 연결을 완료하거나 취소한 뒤 앱으로 돌아와 주세요.",
    );
  }, []);
  const unlinkGoogleIdentity = useCallback(async () => {
    if (!supabase || !current.current?.user)
      throw new Error("로그인이 필요해요.");
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    const identities = data.user.identities ?? [];
    const googleIdentity = identities.find(
      (identity) => identity.provider === "google",
    );
    if (!googleIdentity) throw new Error("연결된 Google 계정이 없어요.");
    if (!identities.some((identity) => identity.provider === "email"))
      throw new Error("이메일 로그인 수단을 먼저 확인한 뒤 연결을 해제해 주세요.");
    const result = await supabase.auth.unlinkIdentity(googleIdentity);
    if (result.error) throw result.error;
    const updatedUser = await supabase.auth.getUser();
    if (updatedUser.error) throw updatedUser.error;
    const storedSession = await supabase.auth.getSession();
    if (storedSession.data.session) {
      const nextSession = {
        ...storedSession.data.session,
        user: updatedUser.data.user,
      };
      current.current = nextSession;
      setSession(nextSession);
    }
    setGoogleAuthNotice("Google 로그인 연결을 해제했어요. 앱 계정은 유지돼요.");
  }, []);
  const saveMyName = useCallback(async (name: string) => {
    const user = current.current?.user.id;
    if (!supabase || !user) throw new Error("로그인이 필요해요.");
    const result = await supabase
      .from("profiles")
      .update({ private_name: name })
      .eq("user_id", user)
      .select("private_name")
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new Error("프로필을 저장하지 못했어요.");
    const savedName = result.data.private_name;
    setProfile((profile) => ({
      private_name: savedName,
      partner_name: profile?.partner_name ?? null,
    }));
  }, []);
  const saveRelationshipStart = useCallback(async (date: string) => {
    const result = await db().rpc("set_relationship_start", {
      p_relationship_start: date,
    });
    if (result.error) throw result.error;
    await refresh();
  }, [refresh]);
  return (
    <Auth.Provider
      value={{
        session,
        couple,
        profile,
        count,
        eventsRevision,
        invalidateEvents,
        loading: !ready || loading,
        error,
        refresh,
        saveMyName,
        saveRelationshipStart,
        logout,
        googleAuthNotice,
        linkGoogleIdentity,
        unlinkGoogleIdentity,
      }}
    >
      {children}
    </Auth.Provider>
  );
}
export const useAuth = () => useContext(Auth);
