import type {
  LanguageModel,
  ModelRequest,
  TranscribeInput,
  Transcript,
  TranscriptionProvider,
} from '../ai.js';
import { fail, ok } from '../result.js';
import { MockConnector } from './base.js';

/**
 * Mock transcription and language model. Both record every request, so tests can prove what
 * did and did not reach the AI layer (for example: nothing from a clinic tenant).
 */

export class MockTranscriptionProvider extends MockConnector implements TranscriptionProvider {
  readonly requests: TranscribeInput[] = [];
  private readonly transcripts = new Map<string, Transcript>();

  constructor() {
    super('TR');
  }

  /** Scripts the transcript for a recording, e.g. from the MOCK_DATA.md evaluation set. */
  setTranscript(recordingRef: string, transcript: Transcript): void {
    this.transcripts.set(recordingRef, transcript);
  }

  async transcribe(input: TranscribeInput) {
    this.requests.push(input);
    return this.once(input.tenantId, input.idempotencyKey, () => {
      const transcript = this.transcripts.get(input.recordingRef);
      return transcript
        ? ok(transcript)
        : fail('permanent', 'recording_not_found', 'No mock transcript for this recording');
    });
  }
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
