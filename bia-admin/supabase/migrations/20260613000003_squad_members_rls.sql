-- Squad Phase 0 (3/4): fix the policy that hid joiners from their own organizer.
-- Old: "Squad members viewable by owner" (user_id = auth.uid()) — joiner sees self only;
-- the organizer could never list who joined their 局 (eng outside-voice #5).
drop policy if exists "Squad members viewable by owner" on public.squad_members;

create policy "Members visible to self and post organizer"
  on public.squad_members for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.squad_posts p
      where p.id = squad_members.post_id and p.user_id = auth.uid()
    )
  );
