# Reader comments backend

Comments are stored in Supabase so they persist and are shared between readers.
Without it `app.js` falls back to `localStorage`, which is private to one
browser and lost when site data is cleared.

## Setup

1. Create a free project at supabase.com.
2. Open **SQL Editor**, paste `comments-setup.sql`, run it.
3. Open **Settings -> API** and copy the **Project URL** and the **anon public**
   key.
4. Put both in `comments-config.js` at the repository root:

   ```js
   window.SUPABASE_CFG = {
     url: "https://<project-ref>.supabase.co",
     anonKey: "<anon public key>",
     table: "comments",
   };
   ```

The anon key is designed to sit in public client code. It grants only what the
row-level-security policies above allow: read any comment, add a comment within
the length limits, delete nothing.

## Checking it works

Open the site, highlight a passage, add a comment, then reload in a private
window. The comment should still be there. In the Supabase dashboard it appears
under **Table Editor -> comments**.

## Moderating

Delete rows from the dashboard. There is no in-page delete for visitors, by
design.
