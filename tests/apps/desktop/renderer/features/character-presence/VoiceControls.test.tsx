/* Protects the compact Character Presence voice layout and keeps profile management in Settings. */
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceControls } from '@megumi/desktop/renderer/features/character-presence/components/VoiceControls';

function baseAudioSnapshot() {
  return {
    microphone: 'closed' as const,
    speech: 'stopped' as const,
    level: 0,
    peak: 0,
    framesReceived: false,
    fallbackToDefault: false,
  };
}

describe('VoiceControls', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        voice: {
          listProfiles: vi.fn().mockResolvedValue({
            ok: true,
            data: {
              status: 'ok',
              profiles: [{ profileId: 'default', name: 'Default', selected: true }],
            },
          }),
          selectProfile: vi.fn().mockResolvedValue({ ok: true }),
        },
      },
    });
  });

  it('keeps profile selection and start voice in one row without profile creation', async () => {
    render(<VoiceControls voice={{
      voiceSnapshot: { status: 'idle' },
      audioSnapshot: baseAudioSnapshot(),
      draft: '',
      error: null,
      setDraft: vi.fn(),
      discardDraft: vi.fn(),
      submitText: vi.fn(),
      start: vi.fn(),
    } as never} playing={false} />);

    const row = await screen.findByTestId('voice-primary-row');
    expect(row).toContainElement(screen.getByRole('combobox', { name: 'Voice' }));
    expect(row).toContainElement(screen.getByRole('button', { name: 'Start voice' }));
    expect(screen.queryByRole('button', { name: 'Add voice' })).not.toBeInTheDocument();
  });

  it('aligns manual text input and send action to the same control height', () => {
    render(<VoiceControls voice={{
      voiceSnapshot: { status: 'idle' },
      audioSnapshot: baseAudioSnapshot(),
      draft: 'hello',
      error: null,
      setDraft: vi.fn(),
      discardDraft: vi.fn(),
      submitText: vi.fn(),
      start: vi.fn(),
    } as never} playing={false} />);

    expect(screen.getByTestId('voice-text-row')).toHaveClass('items-stretch');
    expect(screen.getByRole('textbox', { name: 'Character window text input' })).toHaveClass('h-10');
    expect(screen.getByRole('button', { name: 'Send input' })).toHaveClass('h-10');
  });

  it('shows a disabled preparation state while the complete voice mode is warming up', async () => {
    render(<VoiceControls voice={{
      voiceSnapshot: { status: 'idle' },
      audioSnapshot: baseAudioSnapshot(),
      preparing: true,
      draft: '',
      error: null,
      setDraft: vi.fn(),
      discardDraft: vi.fn(),
      submitText: vi.fn(),
      start: vi.fn(),
    } as never} playing={false} />);

    const button = await screen.findByRole('button', { name: 'Preparing voice…' });
    expect(button).toBeDisabled();
  });

  it('shows real microphone level and the listening phase while voice mode is active', async () => {
    render(<VoiceControls voice={{
      voiceSnapshot: {
        status: 'listening',
        boundSessionId: 'session-1',
        voiceProfileId: 'default',
        muted: false,
      },
      audioSnapshot: {
        ...baseAudioSnapshot(),
        microphone: 'capturing',
        speech: 'listening',
        level: 0.62,
        framesReceived: true,
      },
      draft: '',
      error: null,
      setDraft: vi.fn(),
      discardDraft: vi.fn(),
      submitText: vi.fn(),
      start: vi.fn(),
      end: vi.fn(),
      setMuted: vi.fn(),
    } as never} playing={false} />);

    expect(await screen.findByTestId('voice-input-status')).toHaveTextContent('Listening');
    expect(screen.getByTestId('voice-input-meter')).toHaveStyle({ width: '62%' });
  });

  it('distinguishes speech detected from plain listening', async () => {
    render(<VoiceControls voice={{
      voiceSnapshot: {
        status: 'listening',
        boundSessionId: 'session-1',
        voiceProfileId: 'default',
        muted: false,
      },
      audioSnapshot: {
        ...baseAudioSnapshot(),
        microphone: 'capturing',
        speech: 'speech-detected',
        level: 0.4,
        framesReceived: true,
      },
      draft: '',
      error: null,
      setDraft: vi.fn(),
      discardDraft: vi.fn(),
      submitText: vi.fn(),
      start: vi.fn(),
      end: vi.fn(),
      setMuted: vi.fn(),
    } as never} playing={false} />);

    expect(await screen.findByTestId('voice-input-status')).toHaveTextContent('I hear you speaking');
  });

  it('explains that recognition is in progress and no next sentence is accepted', async () => {
    render(<VoiceControls voice={{
      voiceSnapshot: {
        status: 'recognizing',
        boundSessionId: 'session-1',
        voiceProfileId: 'default',
        muted: false,
      },
      audioSnapshot: {
        ...baseAudioSnapshot(),
        microphone: 'capturing',
        speech: 'recognizing',
        level: 0,
        framesReceived: true,
      },
      draft: '',
      error: null,
      setDraft: vi.fn(),
      discardDraft: vi.fn(),
      submitText: vi.fn(),
      start: vi.fn(),
      end: vi.fn(),
      setMuted: vi.fn(),
    } as never} playing={false} />);

    expect(await screen.findByTestId('voice-input-status')).toHaveTextContent('Recognizing');
  });

  it('offers click start and click finish when automatic boundary detection is unavailable', async () => {
    render(<VoiceControls voice={{
      voiceSnapshot: {
        status: 'listening',
        boundSessionId: 'session-1',
        voiceProfileId: 'default',
        muted: false,
      },
      audioSnapshot: {
        ...baseAudioSnapshot(),
        microphone: 'capturing',
        speech: 'automatic-boundary-unavailable',
        level: 0.1,
        framesReceived: true,
      },
      draft: '',
      error: null,
      setDraft: vi.fn(),
      discardDraft: vi.fn(),
      submitText: vi.fn(),
      start: vi.fn(),
      end: vi.fn(),
      setMuted: vi.fn(),
      beginManual: vi.fn(),
      finishManual: vi.fn(),
    } as never} playing={false} />);

    expect(await screen.findByTestId('voice-input-status')).toHaveTextContent('Automatic boundary unavailable');
    expect(screen.getByTestId('voice-manual-start')).toHaveTextContent('Start recording');
    expect(screen.getByTestId('voice-manual-finish')).toHaveTextContent('Finish recording');
  });

  it('shows the overflow notice when audio processing fell behind', () => {
    render(<VoiceControls voice={{
      voiceSnapshot: {
        status: 'listening',
        boundSessionId: 'session-1',
        voiceProfileId: 'default',
        muted: false,
      },
      audioSnapshot: {
        ...baseAudioSnapshot(),
        microphone: 'capturing',
        speech: 'listening',
        level: 0.2,
        framesReceived: true,
        issue: 'overflow',
      },
      draft: '',
      error: null,
      setDraft: vi.fn(),
      discardDraft: vi.fn(),
      submitText: vi.fn(),
      start: vi.fn(),
      end: vi.fn(),
      setMuted: vi.fn(),
    } as never} playing={false} />);

    expect(screen.getByText('Audio processing fell behind. Please say that again.')).toBeInTheDocument();
  });
});
