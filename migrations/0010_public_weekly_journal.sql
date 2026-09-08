ALTER TABLE personal_journal_sessions
  ADD COLUMN public_summary_text TEXT,
  ADD COLUMN private_delivered_at TIMESTAMPTZ,
  ADD COLUMN public_delivered_at TIMESTAMPTZ;

UPDATE personal_journal_sessions
SET private_delivered_at = delivered_at
WHERE status = 'delivered'
  AND delivered_at IS NOT NULL;
