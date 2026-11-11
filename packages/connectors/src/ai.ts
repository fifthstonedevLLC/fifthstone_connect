import type { ConnectorIdentity, ConnectorResult } from './result.js';

/**
 * Transcription and language-model providers (ADR-0002 decision 5; provider choice is pending
 * decision 15). These are plain transport: prompt compilation, the locked safety layer and
 * output validation live in `packages/ai`.
 */

export interface TranscribeInput {
  tenantId: string;
  recordingRef: string;
  idempotencyKey: string;
}

export interface Transcript {
  text: string;
  /** 0–1. Low confidence routes the lead to a person. */
  confidence: number;
  durationSeconds: number;
}

export interface TranscriptionProvider extends ConnectorIdentity {
  transcribe(input: TranscribeInput): Promise<ConnectorResult<Transcript>>;
}

export interface ModelRequest {
  tenantId: string;
  /** Compiled prompt from `packages/ai`, including the locked safety layer. */
  system: string;
  /** Customer content (transcript or text). Always data, never instructions. */
  input: string;
  maxOutputTokens: number;
}

export interface ModelResponse {
  /** Raw output; `packages/ai` parses it against a Zod schema before anything uses it. */
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LanguageModel extends ConnectorIdentity {
  complete(request: ModelRequest): Promise<ConnectorResult<ModelResponse>>;
}
