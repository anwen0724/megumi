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
  const listProfiles = vi.fn();

  beforeEach(() => {
    getModelStatus.mockReset().mockResolvedValue(success({
      status: 'not_prepared', bundleVersion: 'voice-v1', downloadedBytes: 0, totalBytes: 926_208_003,
    }));
    checkModelUpdates.mockReset().mockResolvedValue(success({ status: 'unavailable' }));
    prepareModels.mockReset().mockResolvedValue(success({ status: 'ok' }));
    cancelModelPreparation.mockReset().mockResolvedValue(success({ status: 'ok' }));
    listProfiles.mockReset().mockResolvedValue(success({ status: 'ok', profiles: [] }));
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        voice: {
          getModelStatus,
          checkModelUpdates,
          prepareModels,
          cancelModelPreparation,
          listProfiles,
          importProfile: vi.fn(),
          selectProfile: vi.fn(),
        },
      },
    });
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
});

function success(data: unknown) {
  return { ok: true, data, meta: {} };
}
