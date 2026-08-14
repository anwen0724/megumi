// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceSettingsPanel } from '@megumi/desktop/renderer/features/voice-settings/VoiceSettingsPanel';

describe('VoiceSettingsPanel', () => {
  const getModelStatus = vi.fn();
  const checkModelUpdates = vi.fn();
  const prepareModels = vi.fn();
  const cancelModelPreparation = vi.fn();
  const getSettings = vi.fn();
  const updateSettings = vi.fn();

  beforeEach(() => {
    getModelStatus.mockReset().mockResolvedValue(success({
      status: 'not_prepared', bundleVersion: 'voice-v1', downloadedBytes: 0, totalBytes: 926_208_003,
    }));
    checkModelUpdates.mockReset().mockResolvedValue(success({ status: 'unavailable' }));
    prepareModels.mockReset().mockResolvedValue(success({ status: 'ok' }));
    cancelModelPreparation.mockReset().mockResolvedValue(success({ status: 'ok' }));
    const resolvedVoice = {
      inputDeviceId: 'mic-1', outputDeviceId: 'speaker-1', recognitionLanguage: 'auto' as const,
      readAloudEnabled: false,
      tts: { provider: 'minimax', voiceId: 'female-shaonv', hasApiKey: false, credentialSource: 'missing' },
    };
    getSettings.mockReset().mockResolvedValue(success({ status: 'ok', settings: { voice: resolvedVoice } }));
    updateSettings.mockReset().mockResolvedValue(success({ status: 'updated', settings: { voice: resolvedVoice } }));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn(async () => [
          { kind: 'audioinput', deviceId: 'mic-1', label: 'USB Microphone' },
          { kind: 'audiooutput', deviceId: 'speaker-1', label: 'USB Headphones' },
        ]),
        getUserMedia: vi.fn(),
      },
    });
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        voice: {
          getModelStatus,
          checkModelUpdates,
          prepareModels,
          cancelModelPreparation,
        },
        settings: {
          get: getSettings,
          update: updateSettings,
          setVoiceTtsApiKey: vi.fn().mockResolvedValue(success({ status: 'updated', tts: resolvedVoice.tts })),
          deleteVoiceTtsApiKey: vi.fn().mockResolvedValue(success({ status: 'deleted', tts: resolvedVoice.tts })),
        },
      },
    });
  });

  it('shows the saved microphone and the saved output device', async () => {
    render(<VoiceSettingsPanel />);

    expect(await screen.findByRole('combobox', { name: /Input device/i })).toHaveValue('mic-1');
    expect(screen.getByText('USB Microphone')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Output device/i })).toHaveValue('speaker-1');
    expect(screen.getByText('USB Headphones')).toBeInTheDocument();
  });

  it('shows one user-facing Voice model resource and starts download only after an explicit click', async () => {
    const user = userEvent.setup();
    render(<VoiceSettingsPanel />);

    expect(await screen.findByText('Voice models')).toBeInTheDocument();
    expect(screen.queryByText(/STT|TTS|SenseVoice|MOSS/i)).not.toBeInTheDocument();
    expect(prepareModels).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(prepareModels).toHaveBeenCalledOnce());
  });

  it('shows byte progress and cancellation while the model is downloading', async () => {
    getModelStatus.mockResolvedValue(success({
      status: 'preparing',
      phase: 'downloading',
      bundleVersion: 'voice-v1',
      downloadedBytes: 231_552_000,
      totalBytes: 926_208_000,
      progress: 0.25,
      bytesPerSecond: 10_485_760,
    }));
    render(<VoiceSettingsPanel />);

    expect(await screen.findByText('25%')).toBeInTheDocument();
    expect(screen.getByText(/220\.8 MB \/ 883\.3 MB/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('reports a ready Voice model without exposing voice profile management', async () => {
    getModelStatus.mockResolvedValue(success({ status: 'ready', bundleVersion: 'voice-v1' }));
    render(<VoiceSettingsPanel />);

    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(screen.queryByTestId('voice-profile-scroll')).not.toBeInTheDocument();
  });
});

function success(data: unknown) {
  return { ok: true, data, meta: {} };
}
