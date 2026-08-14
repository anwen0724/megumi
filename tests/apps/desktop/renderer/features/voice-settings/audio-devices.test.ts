import { describe, expect, it, vi } from 'vitest';
import {
  createInputConstraints,
  enumerateAudioDevices,
} from '../../../../../../apps/desktop/src/renderer/features/voice-settings/audio-devices';

describe('audio device settings', () => {
  it('keeps system default and lists only input devices', async () => {
    const result = await enumerateAudioDevices({
      mediaDevices: {
        getUserMedia: vi.fn(),
        enumerateDevices: vi.fn(async () => [
          { kind: 'audioinput', deviceId: 'mic-1', label: 'USB Mic' },
          { kind: 'audiooutput', deviceId: 'speaker-1', label: 'Headphones' },
        ] as MediaDeviceInfo[]),
      },
    });

    expect(result).toEqual({
      inputs: [
        { deviceId: 'default', label: 'System default' },
        { deviceId: 'mic-1', label: 'USB Mic' },
      ],
    });
  });

  it('uses an exact constraint for a selected microphone', () => {
    expect(createInputConstraints('usb-mic')).toMatchObject({ deviceId: { exact: 'usb-mic' } });
    expect(createInputConstraints('default')).not.toHaveProperty('deviceId');
  });
});
