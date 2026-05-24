-- 20260524000004_articles_rejection_fields.sql
-- Reject sends the article from in_review back to draft. Without a note
-- saved on the row the author has no way to see why. Add fields that
-- record the most recent rejection.

alter table public.articles
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists rejected_by uuid references public.admin_users(id);
