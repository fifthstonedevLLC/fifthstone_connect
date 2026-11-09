/**
 * The clarify step (SCOPE.md v0.2, step 2): ask only for what is missing, one question per text,
 * three questions at most, then offer times. The questions are the owner's own, from their AI
 * settings, sent word for word; the AI layer only says which ones the customer has answered.
 * Anything risky or unclear goes to a person instead of another question.
 */

export const MAX_CLARIFYING_QUESTIONS = 3;

export interface ClarifyFacts {
  /** How many questions the owner asks, in order. */
  questionCount: number;
  /** Indexes the customer has clearly answered (from the AI layer). */
  answered: readonly number[];
  /** Indexes already asked on this lead, in the order they were sent. */
  asked: readonly number[];
  emergency: boolean;
  outOfScope: boolean;
  priceQuestion: boolean;
}

export type ClarifyPlan =
  | { kind: 'ask'; question: number }
  | { kind: 'offer' }
  | { kind: 'person'; reason: 'emergency' | 'price_question' | 'out_of_scope' | 'unsure' };

export function planClarify(facts: ClarifyFacts): ClarifyPlan {
  // Someone may be at risk: a person calls now, before anything else is asked.
  if (facts.emergency) return { kind: 'person', reason: 'emergency' };
  // Prices only ever come from the owner; work they don't do is theirs to turn down.
  if (facts.priceQuestion) return { kind: 'person', reason: 'price_question' };
  if (facts.outOfScope) return { kind: 'person', reason: 'out_of_scope' };

  const answered = new Set(facts.answered);
  const next = Array.from({ length: facts.questionCount }, (_, i) => i).find(
    (i) => !answered.has(i),
  );
  if (next === undefined) return { kind: 'offer' };
  // A question asked and still not answered, or three asked already: a person takes over
  // rather than asking again.
  if (facts.asked.includes(next) || facts.asked.length >= MAX_CLARIFYING_QUESTIONS) {
    return { kind: 'person', reason: 'unsure' };
  }
  return { kind: 'ask', question: next };
}

/**
 * Which of the owner's questions have been sent, in order, found by their exact wording inside
 * any text that went out (a question on its own, or one inside the text-back).
 */
export function askedIndexes(sent: readonly string[], questions: readonly string[]): number[] {
  return sent.flatMap((body) =>
    questions.flatMap((q, i) => (q.trim() !== '' && body.includes(q.trim()) ? [i] : [])),
  );
}

/**
 * Values for the owner's text-back: `{need}` from a voicemail reading, if one passed its guard,
 * and `{question}`, the owner's first question not yet answered. A missing value leaves its
 * sentence out of the text (`withoutUnfilled`); nothing is made up.
 */
export function textBackValues(
  reading: { need?: string | null; answered: readonly number[] } | null,
  questions: readonly string[],
): { need?: string; question?: string } {
  const answered = new Set(reading?.answered ?? []);
  const question = questions.find((_, i) => !answered.has(i));
  return {
    ...(reading?.need ? { need: reading.need } : {}),
    ...(question ? { question } : {}),
  };
}
