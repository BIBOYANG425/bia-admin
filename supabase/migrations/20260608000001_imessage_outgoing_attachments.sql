-- Extend imessage_outgoing to support iMessage attachments (images + files).
--
-- Slice B onboarding handshake sends a vcf contact card + 5 showcase images
-- alongside text. The @photon-ai/imessage-kit SDK supports sdk.send(to, {text?, images?, files?})
-- natively, but the iPhone Shortcut path goes through this queue table which was text-only.
--
-- Each queued row may carry text, images (PNG/JPG paths), and files (other
-- attachments like .vcf contact cards). The iPhone Shortcut will need a parallel
-- update to read these columns and include attachments in the Messages.app
-- send — that Shortcut spec change happens out-of-repo.

alter table public.imessage_outgoing
  add column if not exists images text[] not null default '{}',
  add column if not exists files text[] not null default '{}';

-- text column was required before; with attachment-only rows now possible, make it nullable.
alter table public.imessage_outgoing
  alter column text drop not null;

-- Sanity: at least one of text, images, files must be non-empty per row.
alter table public.imessage_outgoing
  add constraint imessage_outgoing_has_content
  check (
    (text is not null and length(text) > 0)
    or array_length(images, 1) > 0
    or array_length(files, 1) > 0
  );
