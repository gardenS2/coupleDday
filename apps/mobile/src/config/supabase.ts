// Values are injected by scripts/expo-env.mjs from config/env/.env.dev or .env.prod.
// GitHub Actions recreates that file from the selected Environment secret.
// Never put keys directly in tracked TypeScript source.
export const supabaseConfig = {
  url: process.env.EXPO_PUBLIC_SUPABASE_URL || "",
  publishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
};
