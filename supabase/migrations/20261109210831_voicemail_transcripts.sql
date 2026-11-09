-- Purpose: Voicemail transcription. The worker writes a recording's transcript and its confidence
--          once transcribed. Only those two columns can change; the recording, its call and its
--          tenant stay as recorded. Clinics' voicemails are never transcribed (enforced in code,
--          CLAUDE.md rule 13).
-- Tables: app.voicemails (column-level update grant to fsc_app)
-- Rollback: Local only so far (`npm run db:reset`). Once pushed, a superseding migration revokes
--           the grant; transcripts already written stay.
-- Ref: SCOPE.md v0.2 (step 2, Clarify); CLAUDE.md rules 3 and 13.

grant update (transcript, transcript_confidence) on app.voicemails to fsc_app;
