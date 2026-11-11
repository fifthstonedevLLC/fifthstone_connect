import type {
  LanguageModel,
  ModelRequest,
  TranscribeInput,
  Transcript,
  TranscriptionProvider,
} from '../ai.js';
import { fail, ok } from '../result.js';
import { MockConnector, type MockOptions } from './base.js';

/**
 * Mock transcription and language model. Both record every request, so tests can prove what
 * did and did not reach the AI layer.
 */

/** Mock recordings for local runs: `MOCK-SAYS-` and the words, base64url-encoded. */
export const MOCK_SAYS_PREFIX = 'MOCK-SAYS-';

/** A mock recording reference that "says" these words (the mock transcriber reads them back). */
export function mockRecordingSaying(words: string): string {
  return MOCK_SAYS_PREFIX + Buffer.from(words, 'utf8').toString('base64url');
}

export class MockTranscriptionProvider extends MockConnector implements TranscriptionProvider {
  readonly requests: TranscribeInput[] = [];
  private readonly transcripts = new Map<string, Transcript>();

  constructor(options: MockOptions = {}) {
    super('TR', options);
  }

  /** Scripts the transcript for a recording, e.g. from the MOCK_DATA.md evaluation set. */
  setTranscript(recordingRef: string, transcript: Transcript): void {
    this.transcripts.set(recordingRef, transcript);
  }

  async transcribe(input: TranscribeInput) {
    this.requests.push(input);
    return this.once(input.tenantId, input.idempotencyKey, () => {
      const transcript = this.transcripts.get(input.recordingRef) ?? spokenIn(input.recordingRef);
      return transcript
        ? ok(transcript)
        : fail('permanent', 'recording_not_found', 'No mock transcript for this recording');
    });
  }
}

/** The words in a `MOCK-SAYS-` recording reference, as a clear transcript. Mock only. */
function spokenIn(recordingRef: string): Transcript | undefined {
  if (!recordingRef.startsWith(MOCK_SAYS_PREFIX)) return undefined;
  const text = Buffer.from(recordingRef.slice(MOCK_SAYS_PREFIX.length), 'base64url').toString(
    'utf8',
  );
  return { text, confidence: 0.92, durationSeconds: Math.max(3, Math.round(text.length / 15)) };
}

/** Rough token estimate (about four characters per token), for cost tracking in tests. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class MockLanguageModel extends MockConnector implements LanguageModel {
  readonly requests: ModelRequest[] = [];
  private readonly scripts: { when: (request: ModelRequest) => boolean; text: string }[] = [];

  constructor() {
    super('LM');
  }

  /** Scripts a response. The first script whose `when` matches wins; no match is an error. */
  respondWith(text: string, when: (request: ModelRequest) => boolean = () => true): void {
    this.scripts.push({ when, text });
  }

  async complete(request: ModelRequest) {
    this.requests.push(request);
    return this.run(() => {
      const script = this.scripts.find((s) => s.when(request));
      if (!script) {
        return fail('permanent', 'no_scripted_response', 'No mock response matches this request');
      }
      return ok({
        text: script.text,
        model: 'mock-model',
        inputTokens: estimateTokens(request.system + request.input),
        outputTokens: estimateTokens(script.text),
      });
    });
  }
}

const ADDRESS =
  /\b\d{2,6}\s+[A-Za-z][A-Za-z ]*\s(?:St|Street|Ave|Avenue|Rd|Road|Ln|Lane|Dr|Drive|Blvd|Way|Ct|Court)\b[^\n]*/i;

/**
 * A stand-in for the clarify step's model when running locally: fixed rules, not AI. It reads
 * the fenced customer messages and the numbered questions in the prompt, and answers in the same
 * JSON shape a real model must, so the whole loop can run with no provider. A question that
 * mentions an address is answered by an address-like line; one that asks how soon, by 1, 2 or 3
 * (or "today", "this week", "whenever"); any other question, by a message of a few words. Mock
 * only (CLAUDE.md rule 5): its model name is `mock-rules`.
 */
export class MockRulesModel extends MockConnector implements LanguageModel {
  readonly requests: ModelRequest[] = [];

  constructor(options: MockOptions = {}) {
    super('LM', options);
  }

  async complete(request: ModelRequest) {
    this.requests.push(request);
    return this.run(() => {
      const fenced = /<customer>\n([\s\S]*)\n<\/customer>/.exec(request.input)?.[1] ?? '';
      const messages = fenced
        .split('\n---\n')
        .map((m) => m.trim())
        .filter(Boolean);
      const questions = [...request.system.matchAll(/^(\d): (.+)$/gm)].map((m) => m[2]!);
      const address = messages.map((m) => ADDRESS.exec(m)?.[0]?.trim()).find(Boolean) ?? null;
      const urgencyWord =
        messages
          .map((m) => m.toLowerCase())
          .map((m) =>
            /^\s*1\s*$|\btoday\b|\basap\b/.test(m)
              ? 'emergency'
              : /^\s*2\s*$|\bthis week\b/.test(m)
                ? 'this_week'
                : /^\s*3\s*$|\bwhenever\b|\bflexible\b/.test(m)
                  ? 'flexible'
                  : null,
          )
          .find(Boolean) ?? null;
      const problem =
        messages.find((m) => m.replace(ADDRESS, '').split(/\s+/).filter(Boolean).length >= 3) ??
        null;
      const answered = questions.flatMap((q, i) => {
        const text = q.toLowerCase();
        if (text.includes('address')) return address ? [i] : [];
        if (text.includes('how soon') || text.includes('when')) return urgencyWord ? [i] : [];
        return problem ? [i] : [];
      });
      const all = messages.join(' ');
      // The first sentence of what they said, as it would follow "Sounds like".
      const firstSentence = problem?.replace(ADDRESS, '').split(/[.!?]/)[0]?.trim() ?? '';
      const greetingless = firstSentence.replace(/^(hi|hello|hey)[, ]+/i, '');
      const phrase = firstSentence.replace(/^(hi|hello|hey)[, ]+/i, '').replace(/^my\b/i, 'your');
      const need =
        /^[A-Za-z][A-Za-z' ,-]*$/.test(phrase) && phrase.length <= 60
          ? phrase.charAt(0).toLowerCase() + phrase.slice(1)
          : null;
      const output = {
        answered,
        need,
        // Their first sentence, without a greeting, as one short line for the business.
        summary: greetingless
          ? `${greetingless.charAt(0).toUpperCase()}${greetingless.slice(1, 119)}.`
          : null,
        category: null,
        urgency: urgencyWord,
        address,
        emergency: /gas smell|smell gas|flood/i.test(all),
        out_of_scope: false,
        price_question: /how much|\bprice\b|\bcost\b/i.test(all),
      };
      const text = JSON.stringify(output);
      return ok({
        text,
        model: 'mock-rules',
        inputTokens: estimateTokens(request.system + request.input),
        outputTokens: estimateTokens(text),
      });
    });
  }
}
