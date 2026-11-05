import { z } from 'zod';
import { AI_FIELD_LIMITS as L } from './ai-limits.js';

/**
 * The owner's AI instructions: structured fields, never a raw prompt (SCOPE.md v0.2). packages/ai
 * compiles them into the prompt inside the locked safety layer, which owners cannot see or edit
 * (CLAUDE.md rule 11). Every field is optional so a new business can start with none. Empty
 * strings are not stored; the portal leaves a blank field out.
 */

const Line = (max: number) => z.string().trim().min(1).max(max);

export const AiSettingsSchema = z
  .object({
    /** The work the business does, in the owner's words. */
    what_we_do: Line(L.what_we_do.chars).optional(),
    /** Work the business turns away; the AI layer marks these out of scope. */
    what_we_dont_do: z.array(Line(L.what_we_dont_do.chars)).max(L.what_we_dont_do.items).optional(),
    /** What counts as an emergency; an emergency alerts the approver at once. */
    emergency: Line(L.emergency.chars).optional(),
    /** Questions to ask before offering times, in order. */
    questions: z.array(Line(L.questions.chars)).max(L.questions.items).optional(),
    /** How the texts should sound. */
    tone: Line(L.tone.chars).optional(),
  })
  .strict();

export type AiSettings = z.output<typeof AiSettingsSchema>;
