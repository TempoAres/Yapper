ALTER TABLE personal_journal_messages
  ADD COLUMN context_message_id TEXT,
  ADD COLUMN context_content TEXT,
  ADD COLUMN context_created_at TIMESTAMPTZ,
  ADD CONSTRAINT personal_journal_context_complete CHECK (
    NUM_NONNULLS(
      context_message_id,
      context_content,
      context_created_at
    ) IN (0, 3)
  );
