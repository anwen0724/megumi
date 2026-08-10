/* Lets Product import a Voice Profile reference clip through Electron's file picker. */
import { dialog } from 'electron';
import type { VoiceProfileAudioPicker } from '@megumi/product';

export const electronVoiceProfileAudioPicker: VoiceProfileAudioPicker = {
  async chooseReferenceAudio() {
    const result = await dialog.showOpenDialog({
      title: '选择参考音频',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'm4a', 'ogg'] }],
    });
    const sourceAudioPath = result.filePaths[0];
    return result.canceled || !sourceAudioPath
      ? { status: 'cancelled' }
      : { status: 'selected', sourceAudioPath };
  },
};
