/* Protects the compact Character Presence voice layout for the STT-only surface. */
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

function voiceProps(overrides: Record<string, unknown> = {}) {
  return {
    voiceSnapshot: { status: 'idle' },
    audioSnapshot: baseAudioSnapshot(),
    draft: '',
    error: null,
    setDraft: vi.fn(),
    discardDraft: vi.fn(),
    submitText: vi.fn(),
    start: vi.fn(),
    ...overrides,
  } as never;
}

describe('VoiceControls', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {},
    });
  });

  it('offers the start voice action without profile management', async () => {
    render(<VoiceControls voice={voiceProps()} />);

    const row = await screen.findByTestId('voice-primary-row');
    expect(row).toContainElement(screen.getByRole('button', { name: 'Start voice' }));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('aligns manual text input and send action to the same control height', () => {
    render(<VoiceControls voice={voiceProps({ draft: 'hello' })} />);

    expect(screen.getByTestId('voice-text-row')).toHaveClass('items-stretch');
    expect(screen.getByRole('textbox', { name: 'Character window text input' })).toHaveClass('h-10');
    expect(screen.getByRole('button', { name: 'Send input' })).toHaveClass('h-10');
  });

  it('shows a disabled preparation state while the complete voice mode is warming up', async () => {
    render(<VoiceControls voice={voiceProps({ preparing: true })} />);

    const button = await screen.findByRole('button', { name: 'Preparing voice…' });
    expect(button).toBeDisabled();
  });

  it('shows real microphone level and the listening phase while voice mode is active', async () => {
    render(<VoiceControls voice={voiceProps({
      voiceSnapshot: { status: 'listening', boundSessionId: 'session-1', muted: false },
      audioSnapshot: {
        ...baseAudioSnapshot(),
        microphone: 'capturing',
        speech: 'listening',
        level: 0.62,
        framesReceived: true,
      },
      end: vi.fn(),
      setMuted: vi.fn(),
    })} />);

    expect(await screen.findByTestId('voice-input-status')).toHaveTextContent('Listening');
    expect(screen.getByTestId('voice-input-meter')).toHaveStyle({ width: '62%' });
  });

  it('distinguishes speech detected from plain listening', async () => {
    render(<VoiceControls voice={voiceProps({
      voiceSnapshot: { status: 'listening', boundSessionId: 'session-1', muted: false },
      audioSnapshot: {
        ...baseAudioSnapshot(),
        microphone: 'capturing',
        speech: 'speech-detected',
        level: 0.4,
        framesReceived: true,
      },
      end: vi.fn(),
      setMuted: vi.fn(),
    })} />);

    expect(await screen.findByTestId('voice-input-status')).toHaveTextContent('I hear you speaking');
  });

  it('explains that recognition is in progress and no next sentence is accepted', async () => {
    render(<VoiceControls voice={voiceProps({
      voiceSnapshot: { status: 'recognizing', boundSessionId: 'session-1', muted: false },
      audioSnapshot: {
        ...baseAudioSnapshot(),
        microphone: 'capturing',
        speech: 'recognizing',
        level: 0,
        framesReceived: true,
      },
      end: vi.fn(),
      setMuted: vi.fn(),
    })} />);

    expect(await screen.findByTestId('voice-input-status')).toHaveTextContent('Recognizing');
  });

  it('offers click start and click finish when automatic boundary detection is unavailable', async () => {
    render(<VoiceControls voice={voiceProps({
      voiceSnapshot: { status: 'listening', boundSessionId: 'session-1', muted: false },
      audioSnapshot: {
        ...baseAudioSnapshot(),
        microphone: 'capturing',
        speech: 'automatic-boundary-unavailable',
        level: 0.1,
        framesReceived: true,
      },
      end: vi.fn(),
      setMuted: vi.fn(),
      beginManual: vi.fn(),
      finishManual: vi.fn(),
    })} />);

    expect(await screen.findByTestId('voice-input-status')).toHaveTextContent('Automatic boundary unavailable');
    expect(screen.getByTestId('voice-manual-start')).toHaveTextContent('Start recording');
    expect(screen.getByTestId('voice-manual-finish')).toHaveTextContent('Finish recording');
  });

  it('shows the overflow notice when audio processing fell behind', () => {
    render(<VoiceControls voice={voiceProps({
      voiceSnapshot: { status: 'listening', boundSessionId: 'session-1', muted: false },
      audioSnapshot: {
        ...baseAudioSnapshot(),
        microphone: 'capturing',
        speech: 'listening',
        level: 0.2,
        framesReceived: true,
        issue: 'overflow',
      },
      end: vi.fn(),
      setMuted: vi.fn(),
    })} />);

    expect(screen.getByText('Audio processing fell behind. Please say that again.')).toBeInTheDocument();
  });

  it('shows the speech output playing status in the panel only', () => {
    render(<VoiceControls voice={voiceProps()} speechOutput={{ status: 'playing' }} />);

    expect(screen.getByTestId('speech-output-status')).toHaveTextContent('Reading the reply…');
  });

  it('maps neutral speech output failure codes to user-facing copy', () => {
    render(<VoiceControls
      voice={voiceProps()}
      speechOutput={{
        status: 'error',
        errorCode: 'voice_tts_quota_exhausted',
        errorMessage: 'supplier detail stays out of the UI',
      }}
    />);

    expect(screen.getByTestId('speech-output-status'))
      .toHaveTextContent('The speech service quota is exhausted. Check the account balance.');
    expect(screen.queryByText(/supplier detail/)).not.toBeInTheDocument();
  });
});
