/* Verifies the run.ended -> speech-output mapping without opening a database. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { onRunEndedForSpeechOutput, type SpeechOutputWiringDeps } from '@megumi/voice';
import type { ReadSpeechOutputRequest, SpeechOutputRuntime } from '../../../../packages/agent/voice/src';

function deps(overrides: Partial<SpeechOutputWiringDeps> = {}): SpeechOutputWiringDeps & {
  speechOutput: SpeechOutputRuntime & { reads: ReadSpeechOutputRequest[] };
  findAssistantReplyByExecutionId: ReturnType<typeof vi.fn>;
} {
  const reads: ReadSpeechOutputRequest[] = [];
  const speechOutput = {
    read: (request: ReadSpeechOutputRequest) => { reads.push(request); },
    stop: vi.fn(),
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    reads,
  };
  const findAssistantReplyByExecutionId = vi.fn(() => ({
    message_kind: 'assistant_reply' as const,
    message_id: 'reply-1',
    session_id: 'session-1',
    execution_id: 'run-1',
    created_at: '2026-08-14T00:00:00.000Z',
    completed_at: '2026-08-14T00:00:01.000Z',
    status: 'completed' as const,
    content: [{ type: 'text' as const, text: '# 你好，世界。' }],
  }));
  const base = {
    speechOutput,
    findAssistantReplyByExecutionId,
    settings: {
      resolve: vi.fn(() => ({
        status: 'ok' as const,
        settings: { voice: { read_aloud_enabled: true } },
      })),
      resolveVoiceTts: vi.fn(() => ({
        status: 'ok' as const,
        settings: {
          provider: 'minimax' as const,
          voice_id: 'female-shaonv',
          has_api_key: true,
          credential_source: 'settings' as const,
        },
      })),
      readVoiceTtsApiKey: vi.fn(() => ({ status: 'found' as const, api_key: 'sk-test', source: 'settings' as const })),
    },
  };
  return { ...base, ...overrides };
}

function completedEvent() {
  return { type: 'run.ended', executionId: 'run-1', sessionId: 'session-1', payload: { status: 'completed' } };
}

describe('onRunEndedForSpeechOutput', () => {
  it('reads the reply into the speech output runtime and reports the read', () => {
    const wiring = deps();
    const result = onRunEndedForSpeechOutput(wiring, completedEvent());

    expect(result).toEqual({ status: 'read' });
    expect(wiring.speechOutput.reads).toEqual([{
      executionId: 'run-1',
      sessionId: 'session-1',
      text: '# 你好，世界。',
      config: { provider: 'minimax', apiKey: 'sk-test', voiceId: 'female-shaonv' },
    }]);
  });

  it('ignores non-completed runs without touching the reply lookup', () => {
    const wiring = deps();
    const failed = onRunEndedForSpeechOutput(wiring, { ...completedEvent(), payload: { status: 'failed' } });

    expect(failed).toEqual({ status: 'ignored' });
    expect(wiring.speechOutput.reads).toHaveLength(0);
    expect(wiring.findAssistantReplyByExecutionId).not.toHaveBeenCalled();
  });

  it('stops the read-aloud when the run is cancelled', () => {
    const wiring = deps();
    const result = onRunEndedForSpeechOutput(wiring, { ...completedEvent(), payload: { status: 'cancelled' } });

    expect(result).toEqual({ status: 'stopped', reason: 'run_cancelled' });
    expect(wiring.speechOutput.stop).toHaveBeenCalledWith('run_cancelled');
    expect(wiring.speechOutput.reads).toHaveLength(0);
  });

  it('skips with a reason when the read-aloud toggle is off', () => {
    const wiring = deps();
    wiring.settings.resolve = vi.fn(() => ({
      status: 'ok' as const,
      settings: { voice: { read_aloud_enabled: false } },
    }));
    const result = onRunEndedForSpeechOutput(wiring, completedEvent());

    expect(result).toEqual({ status: 'skipped', reason: 'read_aloud_disabled' });
    expect(wiring.speechOutput.reads).toHaveLength(0);
  });

  it('passes an empty api key when no credential is configured', () => {
    const wiring = deps();
    wiring.settings.readVoiceTtsApiKey = vi.fn(() => ({ status: 'missing' as const }));
    const result = onRunEndedForSpeechOutput(wiring, completedEvent());

    expect(result).toEqual({ status: 'read' });
    expect(wiring.speechOutput.reads).toEqual([{
      executionId: 'run-1',
      sessionId: 'session-1',
      text: '# 你好，世界。',
      config: { provider: 'minimax', apiKey: '', voiceId: 'female-shaonv' },
    }]);
  });

  it('skips runs without an assistant reply', () => {
    const wiring = deps();
    wiring.findAssistantReplyByExecutionId.mockReturnValueOnce(undefined);
    const result = onRunEndedForSpeechOutput(wiring, completedEvent());

    expect(result).toEqual({ status: 'skipped', reason: 'no_reply' });
    // Text filtering stays in the runtime: the wiring hands over raw reply text.
    expect(onRunEndedForSpeechOutput(wiring, completedEvent())).toEqual({ status: 'read' });
    expect(wiring.speechOutput.reads).toHaveLength(1);
    expect(wiring.speechOutput.reads[0]!.text).toBe('# 你好，世界。');
  });

  it('skips replies with nothing readable', () => {
    const wiring = deps();
    wiring.findAssistantReplyByExecutionId.mockReturnValueOnce({
      message_kind: 'assistant_reply' as const,
      message_id: 'reply-2',
      session_id: 'session-1',
      execution_id: 'run-1',
      created_at: '2026-08-14T00:00:00.000Z',
      completed_at: '2026-08-14T00:00:01.000Z',
      status: 'completed' as const,
      content: [{ type: 'text' as const, text: '   ' }],
    });
    const result = onRunEndedForSpeechOutput(wiring, completedEvent());

    expect(result).toEqual({ status: 'skipped', reason: 'empty_text' });
    expect(wiring.speechOutput.reads).toHaveLength(0);
  });

  it('skips with a reason when settings resolution fails', () => {
    const wiring = deps();
    wiring.settings.resolve = vi.fn(() => ({ status: 'failed' as const, failure: { code: 'x', message: 'y' } }));
    const result = onRunEndedForSpeechOutput(wiring, completedEvent());

    expect(result).toEqual({ status: 'skipped', reason: 'settings_failed' });
    expect(wiring.speechOutput.reads).toHaveLength(0);
  });
});
