-- Column additions for the family roles and multi-member activities.
--
-- schema.sql only ever uses `create ... if not exists`, which cannot add a
-- column to a table that already exists — and SQLite has no
-- `add column if not exists`. So this file is a one-shot: run it once per
-- deployment, before deploying the code that reads these columns.
--
--   npx wrangler d1 execute family-calendar --remote --file lib/migrate.sql
--
-- Re-running is harmless in effect but will error on the first duplicate
-- column, which is the intended signal that it has already been applied.
alter table children add column kind text not null default 'child';
alter table children add column feed_token text;
alter table children add column last_fetched_at text;
alter table events   add column group_id text;
alter table series   add column group_id text;
create unique index if not exists children_feed_token_uidx on children (feed_token);
create index if not exists events_group_idx on events (group_id);
