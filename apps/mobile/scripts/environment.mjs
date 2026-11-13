import { parseEnv } from "node:util";
import { readFileSync } from "node:fs";
export const files = { dev: ".env.dev", prod: ".env.prod" };
export function configFile(root, mode) {
  if (!files[mode]) throw new Error("Environment must be dev or prod.");
  return new URL(`../../config/env/${files[mode]}`, root);
}
const allowed = [
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
];
export function parseConfig(text, mode, { required = false, platform } = {}) {
  if (!files[mode]) throw new Error("Environment must be dev or prod.");
  const values = parseEnv(text);
  if (Object.keys(values).some((key) => !allowed.includes(key)))
    throw new Error(
      "Environment file may contain only the two documented public Supabase settings.",
    );
  const url = values[allowed[0]]?.trim() || "";
  const key = values[allowed[1]]?.trim() || "";
  if (!url && !key && mode === "dev" && !required)
    return Object.fromEntries(allowed.map((key) => [key, ""]));
  if (!url || !key)
    throw new Error("Both Supabase URL and publishable key are required.");
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))
    throw new Error(
      "Use a public sb_publishable_ key, never a service_role or secret key.",
    );
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid Supabase URL.");
  }
  const local = ["localhost", "127.0.0.1", "10.0.2.2"].includes(
    parsed.hostname,
  );
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  )
    throw new Error("Use the Supabase project base URL only.");
  if (mode === "prod" && (parsed.protocol !== "https:" || local))
    throw new Error("Production requires a remote HTTPS project URL.");
  if (
    parsed.protocol !== "https:" &&
    !(mode === "dev" && local && parsed.protocol === "http:")
  )
    throw new Error("Development allows HTTPS or local loopback HTTP only.");
  if (
    mode === "dev" &&
    platform === "android" &&
    ["localhost", "127.0.0.1"].includes(parsed.hostname)
  )
    parsed.hostname = "10.0.2.2";
  return { [allowed[0]]: parsed.origin, [allowed[1]]: key };
}
export function loadConfig(root, mode, options) {
  if (!files[mode]) throw new Error("Environment must be dev or prod.");
  let text;
  try {
    text = readFileSync(configFile(root, mode), "utf8");
  } catch {
    throw new Error(
      `Create config/env/${files[mode]} from its .example file first.`,
    );
  }
  return parseConfig(text, mode, options);
}
export function childEnvironment(parent, values) {
  const env = { ...parent };
  for (const key of Object.keys(env))
    if (key.startsWith("EXPO_PUBLIC_")) delete env[key];
  return { ...env, ...values, EXPO_NO_DOTENV: "1" };
}
