ALTER TABLE public.hmp_document_reminders
  DROP CONSTRAINT hmp_document_reminders_kind_check,
  ADD CONSTRAINT hmp_document_reminders_kind_check CHECK (kind IN ('invoice','contract','form','proposal'));
