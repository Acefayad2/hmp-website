alter table public.hmp_document_reminders
  drop constraint hmp_document_reminders_kind_check,
  add constraint hmp_document_reminders_kind_check
    check (kind in ('invoice','contract','form','proposal','hub'));
