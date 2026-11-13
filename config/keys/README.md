# Local signing credentials

Local signing files may be placed in this directory when a local build requires them. All files here except this README are ignored by Git. Prefer EAS credentials or GitHub Secrets for automated builds. Never place Supabase admin/service-role keys or database passwords here; those belong in an authorized secret manager, not the app bundle.
