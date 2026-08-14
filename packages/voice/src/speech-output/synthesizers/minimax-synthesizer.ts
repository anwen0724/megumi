/*
 * MiniMax T2A v2 streaming adapter for the SpeechSynthesizer seam. Owns all
 * MiniMax specifics — endpoint, auth, request shape, SSE/array parsing, hex
 * decoding, and the official error codes — so the speech-output chain stays
 * provider-neutral. Pure Node HTTP: no Electron imports, no sidecar.
 */

import type {
  SpeechAudioChunk,
  SpeechSynthesizer,
  SynthesizeSpeechRequest,
  VoiceOperationOptions,
} from '../../speech';

export interface CreateMinimaxSynthesizerOptions {
  readonly baseUrl?: string;
  readonly model?: string;
  readonly fetchImpl?: typeof fetch;
}

export function createMinimaxSynthesizer(
  options: CreateMinimaxSynthesizerOptions = {},
): SpeechSynthesizer {
  const baseUrl = options.baseUrl ?? 'https://api.minimaxi.com/v1/t2a_v2';
  const model = options.model ?? 'speech-2.6-hd';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return {
    async synthesize(request: SynthesizeSpeechRequest, operationOptions?: VoiceOperationOptions) {
      const signal = operationOptions?.signal;
      const apiKey = request.config.apiKey.trim();
      if (!apiKey) {
        return {
          status: 'failed',
          failure: { code: 'voice_tts_key_missing', message: 'MiniMax API key is not configured.' },
        };
      }
      let response: Response;
      try {
        response = await fetchImpl(baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            text: request.text,
            stream: true,
            language_boost: 'auto',
            output_format: 'hex',
            voice_setting: {
              voice_id: request.config.voiceId,
              speed: 1,
              vol: 1,
              pitch: 0,
            },
            audio_setting: {
              sample_rate: 32000,
              bitrate: 128000,
              format: 'mp3',
              channel: 1,
            },
          }),
          signal,
        });
      } catch (error) {
        return {
          status: 'failed',
          failure: {
            code: isAbortError(error) ? 'voice_tts_cancelled' : 'voice_tts_request_failed',
            message: messageOf(error),
          },
        };
      }
      if (!response.ok) {
        return {
          status: 'failed',
          failure: {
            code: 'voice_tts_http_failed',
            message: `MiniMax TTS responded with HTTP ${response.status}.`,
          },
        };
      }
      return { status: 'ready', chunks: streamMiniMaxChunks(response.body, signal) };
    },
  };
}

async function* streamMiniMaxChunks(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal,
): AsyncIterable<SpeechAudioChunk> {
  if (!body) throw new Error('MiniMax TTS returned an empty response body.');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sequence = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const payloadText = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
        for (const payload of parsePayloads(payloadText)) {
          const chunk = toSpeechAudioChunk(payload, ++sequence);
          if (chunk) yield chunk;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Tolerates both a single SSE object and an array-shaped streaming payload. */
function parsePayloads(payloadText: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadText);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed : [parsed];
}

function toSpeechAudioChunk(payload: unknown, sequence: number): SpeechAudioChunk | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const envelope = payload as {
    data?: { audio?: unknown; status?: unknown };
    base_resp?: { status_code?: unknown; status_msg?: unknown };
  };
  const baseResp = envelope.base_resp;
  if (baseResp && baseResp.status_code !== 0 && baseResp.status_code !== undefined) {
    throw new Error(typeof baseResp.status_msg === 'string' && baseResp.status_msg
      ? baseResp.status_msg
      : `MiniMax TTS failed with status code ${String(baseResp.status_code)}.`);
  }
  const data = envelope.data;
  if (!data || typeof data.audio !== 'string' || !data.audio) return undefined;
  return {
    bytes: hexToBytes(data.audio),
    format: 'mp3',
    sampleRate: 32000,
    channels: 1,
    sequence,
    final: data.status === 2,
  };
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.length % 2 === 0 ? hex : `0${hex}`;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || (error as Error & { code?: string }).code === 'ABORT_ERR');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
