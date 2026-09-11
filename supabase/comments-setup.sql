-- Reader comments for edekeulenaar.github.io/phd
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- It creates the table app.js expects and the policies that let a public,
-- static site read and add comments with nothing but the anon key.

create table if not exists public.comments (
  id      text primary key,          -- generated client-side
  chapter text not null,             -- toc slug, e.g. "chapter-7"
  name    text not null,
  body    text not null,
  quote   text,                      -- the highlighted passage
  prefix  text,                      -- context before it, for re-anchoring
  suffix  text,                      -- context after it
  ts      bigint not null,           -- client timestamp, ms
  created_at timestamptz not null default now()
);

create index if not exists comments_chapter_idx on public.comments (chapter);

alter table public.comments enable row level security;

-- Anyone may read every comment.
drop policy if exists comments_read on public.comments;
create policy comments_read on public.comments
  for select to anon using (true);

-- Anyone may add one. Length caps keep a stray script from filling the table.
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments
  for insert to anon with check (
    length(name) between 1 and 80
    and length(body) between 1 and 4000
    and length(chapter) between 1 and 64
    and coalesce(length(quote), 0)  <= 2000
    and coalesce(length(prefix), 0) <= 500
    and coalesce(length(suffix), 0) <= 500
  );

-- Deletion is deliberately NOT granted to anon: without it any visitor could
-- remove another reader's comment. Delete from the dashboard, or add a policy
-- keyed to an authenticated account if you want in-page deletion later.
