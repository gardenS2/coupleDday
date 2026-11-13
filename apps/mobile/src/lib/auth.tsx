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
    [error, setError] = useState("");
  const current = useRef(session);
  const generation = useRef(0);
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
    let alive = true,
      changed = false;
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
      }}
    >
      {children}
    </Auth.Provider>
  );
}
export const useAuth = () => useContext(Auth);
