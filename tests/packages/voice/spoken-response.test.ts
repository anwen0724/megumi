import { describe, expect, it, vi } from 'vitest';
import { createVoice, type SpeechPlayer, type SpeechSynthesizer } from '../../../packages/voice/src';

describe('spoken response projection', () => {
  it('speaks stable appended phrases before the reply ends and uses the fixed Voice Profile', async () => {
    const synthesized: Array<{ text: string; voice: { kind: 'built_in'; voiceId: string } }> = [];
    const synthesizer: SpeechSynthesizer = {
      async prepare() { return { status: 'ready' }; },
      async *synthesize(request) {
        if (request.voice.kind !== 'built_in') throw new Error('Expected built-in voice.');
        synthesized.push({ text: request.text, voice: request.voice });
        yield {
          pcm: { samples: new Float32Array([0.1]), sampleRate: 24_000, channels: 1 },
          final: true,
        };
      },
    };
    const played: string[] = [];
    const player: SpeechPlayer = {
      async play(request) {
        for await (const _chunk of request.audio) {}
        played.push(request.segmentId);
        return { status: 'played' };
      },
      async stop() {},
    };
    const voice = createVoice({
      defaultProfile: {
        profileId: 'voice-profile:default',
        name: 'Default',
        source: { kind: 'built_in', voiceId: 'Xiaoyu' },
      },
      synthesizer,
      player,
      ids: {
        createVoiceProfileId: () => 'voice-profile:unused',
        createSpeechSegmentId: () => `segment:${played.length + synthesized.length + 1}`,
      },
    });
    await voice.sessions.start({ boundSessionId: 'session:current' });

    voice.acceptRuntimeFact({
      type: 'assistant_reply_snapshot',
      sessionId: 'session:current',
      messageId: 'message:reply',
      text: '我先检查代码，',
    });
    await vi.waitFor(() => expect(synthesized).toHaveLength(1));
    expect(synthesized[0]).toEqual({
      text: '我先检查代码，',
      voice: { kind: 'built_in', voiceId: 'Xiaoyu' },
    });

    voice.acceptRuntimeFact({
      type: 'assistant_reply_snapshot',
      sessionId: 'session:current',
      messageId: 'message:reply',
      text: '我先检查代码，然后告诉你结果。',
    });
    await vi.waitFor(() => expect(synthesized).toHaveLength(2));
    expect(synthesized.map((item) => item.text)).toEqual(['我先检查代码，', '然后告诉你结果。']);
    expect(played).toHaveLength(2);
  });

  it('reports thinking and speaking from reply and playback facts without changing the bound Session', async () => {
    let finishPlayback: (() => void) | undefined;
    const voice = createVoice({
      defaultProfile: {
        profileId: 'voice-profile:default',
        name: 'Default',
        source: { kind: 'built_in', voiceId: 'Xiaoyu' },
      },
      synthesizer: {
        async prepare() { return { status: 'ready' }; },
        async *synthesize() {
          yield { pcm: { samples: new Float32Array([0.1]), sampleRate: 24_000, channels: 1 }, final: true };
        },
      },
      player: {
        async play(request) {
          for await (const _chunk of request.audio) {}
          await new Promise<void>((resolve) => { finishPlayback = resolve; });
          return { status: 'played' };
        },
        async stop() { finishPlayback?.(); },
      },
    });
    await voice.sessions.start({ boundSessionId: 'session:current' });

    voice.acceptRuntimeFact({
      type: 'assistant_reply_snapshot',
      sessionId: 'session:current',
      messageId: 'message:reply',
      text: '正在回答，',
    });

    await vi.waitFor(() => expect(voice.sessions.getSnapshot()).toMatchObject({
      status: 'speaking',
      boundSessionId: 'session:current',
    }));
    voice.acceptRuntimeFact({
      type: 'run_ended',
      sessionId: 'session:current',
      runId: 'run:1',
      status: 'completed',
    });
    finishPlayback?.();
    await vi.waitFor(() => expect(voice.sessions.getSnapshot()).toMatchObject({ status: 'listening' }));
  });
});
