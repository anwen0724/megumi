/* Verifies the run.ended -> speech-output mapping without opening a database. */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSettings } from '@megumi/application/settings/settings-store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRunEndedForSpeechOutput, type SpeechOutputWiringDeps } from '@megumi/application/voice/index';
import type { ReadSpeechOutputRequest, SpeechOutputRuntime } from '@megumi/application/voice/index';

function deps(overrides: Partial<SpeechOutputWiringDeps> = {}): SpeechOutputWiringDeps & {
  speechOutput: SpeechOutputRuntime & { reads: ReadSpeechOutputRequest[] };
  findAssistantReplyBySessionIdAndExecutionId: ReturnType<typeof vi.fn>;
} {
  const reads: ReadSpeechOutputRequest[] = [];
  const speechOutput = {
    read: (request: ReadSpeechOutputRequest) => { reads.push(request); },
    stop: vi.fn(),
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    reads,
  };
  const findAssistantReplyBySessionIdAndExecutionId = vi.fn(() => ({
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
    findAssistantReplyBySessionIdAndExecutionId,
    settings: fileSettings(),
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
    expect(wiring.findAssistantReplyBySessionIdAndExecutionId).not.toHaveBeenCalled();
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
    wiring.settings = fileSettings({ voice: { readAloudEnabled: false } });
    const result = onRunEndedForSpeechOutput(wiring, completedEvent());

    expect(result).toEqual({ status: 'skipped', reason: 'read_aloud_disabled' });
    expect(wiring.speechOutput.reads).toHaveLength(0);
  });

  it('passes an empty api key when no credential is configured', () => {
    const wiring = deps();
    wiring.settings = fileSettings({ voice: { readAloudEnabled: true } }, false);
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
    wiring.findAssistantReplyBySessionIdAndExecutionId.mockReturnValueOnce(undefined);
    const result = onRunEndedForSpeechOutput(wiring, completedEvent());

    expect(result).toEqual({ status: 'skipped', reason: 'no_reply' });
    // Text filtering stays in the runtime: the wiring hands over raw reply text.
    expect(onRunEndedForSpeechOutput(wiring, completedEvent())).toEqual({ status: 'read' });
    expect(wiring.speechOutput.reads).toHaveLength(1);
    expect(wiring.speechOutput.reads[0]!.text).toBe('# 你好，世界。');
  });

  it('skips replies with nothing readable', () => {
    const wiring = deps();
    wiring.findAssistantReplyBySessionIdAndExecutionId.mockReturnValueOnce({
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
    wiring.settings = fileSettings({ voice: { readAloudEnabled: 'invalid' } });
    const result = onRunEndedForSpeechOutput(wiring, completedEvent());

    expect(result).toEqual({ status: 'skipped', reason: 'settings_failed' });
    expect(wiring.speechOutput.reads).toHaveLength(0);
  });
});

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
function fileSettings(config: unknown = { voice: { readAloudEnabled: true } }, credential = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-config-'));
  directories.push(root);
  const globalSettingsPath = path.join(root, 'settings.json');
  fs.writeFileSync(globalSettingsPath, JSON.stringify(config));
  const settings = createSettings({ globalSettingsPath, credentialsPath: path.join(root, 'credentials.json'), readEnvironment: () => undefined });
  if (credential) settings.updateCredential({ target: { kind: 'voiceTts' }, value: 'sk-test' });
  return settings;
}
