-- Kid-created entries, and recording which devices open a child's link.
--
-- One-shot, like 001. `schema.sql` is all `create ... if not exists`, which
-- cannot add a column, and SQLite has no `add column if not exists`. Run once
-- against an existing deployment, BEFORE deploying the code that reads it:
--
--   npx wrangler d1 execute family-calendar --remote --file lib/migrations/002-kid-entries.sql
--
-- Additive only: every existing event becomes 'parent', which is what it was.
alter table events add column created_by text not null default 'parent';
