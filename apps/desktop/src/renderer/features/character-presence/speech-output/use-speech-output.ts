/*
 * Mounts the speech output playback controller in the Character window.
 * Window visibility owns the D20 stop: hiding stops local playback and asks
 * Main to cancel the running synthesis.
 */

import { useCallback, useEffect, useState } from 'react';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc';
import {
  createSpeechOutputController,
  type SpeechOutputViewSnapshot,
} from './speech-output-controller';

export function useSpeechOutput(): SpeechOutputViewSnapshot {
  const [snapshot, setSnapshot] = useState<SpeechOutputViewSnapshot>({ status: 'idle' });

  const resolveOutputDeviceId = useCallback(async (): Promise<string> => {
    try {
      const result = await window.megumi.settings.get(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.get, {}),
      );
      if (result.ok && result.data.status === 'ok') return result.data.settings.voice.outputDeviceId;
    } catch {
      // A settings read failure falls back to the system default device.
    }
    return 'default';
  }, []);

  useEffect(() => {
    const controller = createSpeechOutputController({
      onEvent: (subscriber) => window.megumi.voice.onSpeechOutputEvent(subscriber),
      resolveOutputDeviceId,
    });
    const subscription = controller.subscribe(setSnapshot);
    const removeCharacterSnapshot = window.megumi.character.onSnapshot((character) => {
      if (!character.visible) {
        controller.stopLocal();
        void window.megumi.voice.stopSpeechOutput(
          createRendererRuntimeIpcRequest(IPC_CHANNELS.voice.speechOutputStop, {}),
        );
      }
    });
    return () => {
      removeCharacterSnapshot();
      subscription.unsubscribe();
      controller.dispose();
    };
  }, [resolveOutputDeviceId]);

  return snapshot;
}
