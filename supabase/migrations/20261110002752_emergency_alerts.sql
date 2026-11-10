-- Purpose: Emergency alerts. When a customer reports a hazard (gas, flooding) or writes crisis
--          language, or the clarify step finds someone may be at risk, the business's approvers
--          are texted at once. Those texts are recorded with the other approver texts as kind
--          'alert', apart from approval requests (a bare "1" never answers an alert).
-- Tables: app.approver_texts (kind check)
-- Rollback: Local only so far (`npm run db:reset`). Once pushed, a superseding migration restores
--           the kind check after removing or reclassifying 'alert' rows.
-- Ref: SCOPE.md v0.2 (Guardrails, emergencies skip the queue); decision 32; CLAUDE.md rule 11.

alter table app.approver_texts drop constraint approver_texts_kind_check;
alter table app.approver_texts add constraint approver_texts_kind_check
  check (kind in ('approval_request', 'reply', 'answer', 'alert'));
