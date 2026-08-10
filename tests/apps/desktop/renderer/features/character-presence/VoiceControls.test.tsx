/* Protects the compact Character Presence voice layout and keeps profile management in Settings. */
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceControls } from '@megumi/desktop/renderer/features/character-presence/components/VoiceControls';

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
      audioSnapshot: { status: 'idle' },
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
      audioSnapshot: { status: 'idle' },
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
      audioSnapshot: { status: 'idle' },
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

  it('shows live microphone input and the current capture phase while voice mode is active', async () => {
    render(<VoiceControls voice={{
      voiceSnapshot: {
        status: 'listening',
        boundSessionId: 'session-1',
        voiceProfileId: 'default',
        muted: false,
      },
      audioSnapshot: {
        status: 'listening',
        inputLevel: 0.62,
        speechProbability: 0.81,
        speechDetected: true,
        audioFramesReceived: true,
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

    expect(await screen.findByTestId('voice-input-status')).toHaveTextContent('Speech detected');
    expect(screen.getByTestId('voice-input-meter')).toHaveStyle({ width: '62%' });
  });
});
