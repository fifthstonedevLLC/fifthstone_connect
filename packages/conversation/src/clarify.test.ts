import { describe, expect, it } from 'vitest';
import { askedIndexes, planClarify, type ClarifyFacts } from './clarify.js';

const facts = (over: Partial<ClarifyFacts>): ClarifyFacts => ({
  questionCount: 3,
  answered: [],
  asked: [],
  emergency: false,
  outOfScope: false,
  priceQuestion: false,
  ...over,
});

describe('planClarify', () => {
  it('asks only for what is missing, in the owner order', () => {
    expect(planClarify(facts({ answered: [0] }))).toEqual({ kind: 'ask', question: 1 });
    expect(planClarify(facts({ answered: [0, 1], asked: [1] }))).toEqual({
      kind: 'ask',
      question: 2,
    });
  });

  it('offers times once every question is answered', () => {
    expect(planClarify(facts({ answered: [2, 0, 1] }))).toEqual({ kind: 'offer' });
    expect(planClarify(facts({ questionCount: 0 }))).toEqual({ kind: 'offer' });
  });

  it('never asks the same question twice, nor more than three', () => {
    expect(planClarify(facts({ answered: [0], asked: [1] }))).toEqual({
      kind: 'person',
      reason: 'unsure',
    });
    expect(planClarify(facts({ questionCount: 5, answered: [0, 1, 2], asked: [0, 1, 2] }))).toEqual(
      { kind: 'person', reason: 'unsure' },
    );
  });

  it('puts risk, prices and work they do not do in front of a person first', () => {
    expect(planClarify(facts({ emergency: true, priceQuestion: true }))).toEqual({
      kind: 'person',
      reason: 'emergency',
    });
    expect(planClarify(facts({ priceQuestion: true }))).toMatchObject({ reason: 'price_question' });
    expect(planClarify(facts({ outOfScope: true }))).toMatchObject({ reason: 'out_of_scope' });
  });
});

describe('askedIndexes', () => {
  it('recognises sent questions by their exact wording', () => {
    const questions = ['What is the problem?', 'What is the address?'];
    expect(askedIndexes(['What is the address? ', 'Thanks!'], questions)).toEqual([1]);
  });
});
