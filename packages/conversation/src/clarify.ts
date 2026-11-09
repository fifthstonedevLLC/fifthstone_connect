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

/** Which of the owner's questions a sent message was, by its exact wording. */
export function askedIndexes(sent: readonly string[], questions: readonly string[]): number[] {
  return sent.map((body) => questions.indexOf(body.trim())).filter((i) => i >= 0);
}
