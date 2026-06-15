/* ───────────────────────────────────────────────────────────────────────────
   Shared reader-comments backend (Supabase).

   Paste your Supabase Project URL and the public "anon" key below. Both are
   designed to be embedded in a public, static site — the anon key only grants
   the access your Row-Level-Security policies allow (here: read + add + delete
   comments). It is NOT a secret and is safe to commit.

   While these are empty, comments fall back to per-browser localStorage and are
   NOT shared between readers.
   ─────────────────────────────────────────────────────────────────────────── */
window.SUPABASE_CFG = {
  url: "",        // e.g. "https://abcdefgh.supabase.co"
  anonKey: "",    // the long "anon public" key from Settings → API
  table: "comments",
};
