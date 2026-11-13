# Local environment files

Environment files for the whole repository live here:

- `.env.dev` — development Supabase URL and publishable key
- `.env.prod` — production Supabase URL and publishable key
- `.env.dev.example` / `.env.prod.example` — safe templates tracked by Git

The real `.env` files are ignored by the root `.gitignore`. The mobile app reads them through `apps/mobile/scripts/expo-env.mjs`; the local Supabase helper writes only the development public settings here.

Only `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` belong in these files. `EXPO_PUBLIC_*` values are bundled into the app and are visible to its users. Never put a Supabase `service_role`, `sb_secret_`, database password, or signing private key here. CI reads the same two public settings from the GitHub Environment secret `MOBILE_ENV_FILE`.
