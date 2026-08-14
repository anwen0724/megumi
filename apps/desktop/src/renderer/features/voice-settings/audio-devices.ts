/*
 * Enumerates renderer-visible audio devices and owns the short microphone level test.
 * Device IDs stay in Settings; MediaStream and Web Audio objects never cross IPC.
 */

export interface AudioDeviceOption {
  readonly deviceId: string;
  readonly label: string;
}

export interface AudioDeviceCatalog {
  readonly inputs: readonly AudioDeviceOption[];
}

export function createInputConstraints(deviceId: string): MediaTrackConstraints {
  const common = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  return deviceId === 'default'
    ? common
    : { ...common, deviceId: { exact: deviceId } };
}

export async function enumerateAudioDevices(options: {
  readonly requestPermission?: boolean;
  readonly mediaDevices?: Pick<MediaDevices, 'enumerateDevices' | 'getUserMedia'>;
} = {}): Promise<AudioDeviceCatalog> {
  const mediaDevices = options.mediaDevices ?? navigator.mediaDevices;
  let permissionStream: MediaStream | undefined;
  if (options.requestPermission) {
    permissionStream = await mediaDevices.getUserMedia({ audio: true });
  }
  try {
    const devices = await mediaDevices.enumerateDevices();
    return {
      inputs: withDefault(devices.filter((device) => device.kind === 'audioinput'), 'Microphone'),
    };
  } finally {
    for (const track of permissionStream?.getTracks() ?? []) track.stop();
  }
}

export async function testMicrophoneLevel(options: {
  readonly deviceId: string;
  readonly onLevel: (level: number) => void;
  readonly durationMs?: number;
}): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: createInputConstraints(options.deviceId),
  });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const values = new Uint8Array(analyser.fftSize);
  const startedAt = performance.now();
  let frame = 0;
  try {
    await new Promise<void>((resolve) => {
      const sample = (now: number) => {
        analyser.getByteTimeDomainData(values);
        let sum = 0;
        for (const value of values) {
          const normalized = (value - 128) / 128;
          sum += normalized * normalized;
        }
        options.onLevel(Math.min(1, Math.sqrt(sum / values.length) * 4));
        if (now - startedAt >= (options.durationMs ?? 4_000)) {
          resolve();
          return;
        }
        frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
    });
  } finally {
    cancelAnimationFrame(frame);
    options.onLevel(0);
    source.disconnect();
    analyser.disconnect();
    for (const track of stream.getTracks()) track.stop();
    await context.close();
  }
}

function withDefault(devices: readonly MediaDeviceInfo[], fallbackLabel: string): AudioDeviceOption[] {
  const concrete = devices.filter((device) => device.deviceId && device.deviceId !== 'default');
  return [
    { deviceId: 'default', label: 'System default' },
    ...concrete.map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `${fallbackLabel} ${index + 1}`,
    })),
  ];
}
