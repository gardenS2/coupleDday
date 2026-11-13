import "react-native-url-polyfill/auto";
import { createClient, processLock } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { supabaseConfig } from "../config/supabase";
const { url, publishableKey: key } = supabaseConfig;
const isLocal = /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?$/.test(
  url,
);
export const configured =
  !!url &&
  key.startsWith("sb_publishable_") &&
  (url.startsWith("https://") || (__DEV__ && isLocal));
// Native tokens are split into ASCII chunks below keychain item limits. Manifest switches last.
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const memory = new Map<string, string>();
const storage = {
  async getItem(k: string) {
    if (Platform.OS === "web") return memory.get(k) ?? null; // preview: no browser token persistence
    const manifest = await SecureStore.getItemAsync(k, options);
    if (!manifest) return null;
    const { generation, count } = JSON.parse(manifest) as {
      generation: string;
      count: number;
    };
    if (!Number.isInteger(count) || count < 1 || count > 100) return null;
    const parts = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        SecureStore.getItemAsync(`${k}.${generation}.${i}`, options),
      ),
    );
    return parts.some((p) => p === null)
      ? null
      : decodeURIComponent(parts.join(""));
  },
  async setItem(k: string, value: string) {
    if (Platform.OS === "web") {
      memory.set(k, value);
      return;
    }
    const old = await SecureStore.getItemAsync(k, options);
    const encoded = encodeURIComponent(value);
    const generation =
      Date.now().toString(36) + Math.random().toString(36).slice(2);
    const count = Math.ceil(encoded.length / 1500);
    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        SecureStore.setItemAsync(
          `${k}.${generation}.${i}`,
          encoded.slice(i * 1500, (i + 1) * 1500),
          options,
        ),
      ),
    );
    await SecureStore.setItemAsync(
      k,
      JSON.stringify({ generation, count }),
      options,
    );
    if (old) {
      const m = JSON.parse(old);
      await Promise.all(
        Array.from({ length: m.count }, (_, i) =>
          SecureStore.deleteItemAsync(`${k}.${m.generation}.${i}`, options),
        ),
      );
    }
  },
  async removeItem(k: string) {
    if (Platform.OS === "web") {
      memory.delete(k);
      return;
    }
    const old = await SecureStore.getItemAsync(k, options);
    await SecureStore.deleteItemAsync(k, options);
    if (old) {
      const m = JSON.parse(old);
      await Promise.all(
        Array.from({ length: m.count }, (_, i) =>
          SecureStore.deleteItemAsync(`${k}.${m.generation}.${i}`, options),
        ),
      );
    }
  },
};
export const supabase = configured
  ? createClient(url, key, {
      auth: {
        storage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        lock: processLock,
      },
    })
  : null;
export function db() {
  if (!supabase) throw new Error("연결 설정이 필요합니다.");
  return supabase;
}
export function friendlyError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : String((error as { message?: string })?.message || "");
  if (/Invalid login/i.test(message))
    return "이메일 또는 비밀번호를 확인해 주세요.";
  if (/Email not confirmed/i.test(message))
    return "이메일 인증을 마친 뒤 로그인해 주세요.";
  if (/already_joined/.test(message)) return "이미 연결된 커플이 있어요.";
  if (/invalid_invite/.test(message))
    return "초대 코드가 만료되었거나 사용할 수 없어요.";
  if (/couple_full/.test(message)) return "이미 두 사람이 연결된 공간이에요.";
  if (/invite_rate_limit|rate limit/i.test(message))
    return "잠시 후 다시 시도해 주세요.";
  if (/invalid_start_date/.test(message))
    return "사귄 날짜는 오늘 또는 이전 날짜로 입력해 주세요.";
  if (/conflict|충돌/.test(message))
    return "상대가 먼저 수정했어요. 새로고침 후 다시 저장해 주세요.";
  if (/exclusion|duplicate key/.test(message))
    return "이미 등록된 날짜 또는 기간과 겹쳐요. 새로고침해 주세요.";
  if (/period_overlap/.test(message))
    return "이미 등록된 생리 기간과 겹쳐요. 날짜를 다시 확인해 주세요.";
  if (/fetch|network/i.test(message))
    return "인터넷 연결을 확인해 주세요. 저장하지 못했어요.";
  return "요청을 완료하지 못했어요. 연결 상태와 입력값을 확인해 주세요.";
}
