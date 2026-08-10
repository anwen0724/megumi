/* Receives renderer acknowledgements for the dedicated Character speech playback channel. */
import { z } from 'zod';
import type { CharacterSpeechPlayerAdapter } from '../../adapters/character-speech-player-adapter';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { IPC_CHANNELS } from '../channels';

const PlaybackResultSchema = z.object({
  segmentId: z.string().min(1),
  status: z.enum(['played', 'stopped', 'failed']),
  message: z.string().optional(),
}).strict();

export function registerVoicePlaybackHandler(
  player: CharacterSpeechPlayerAdapter,
  ipcMain: DesktopIpcMain = electronIpcMain,
): void {
  ipcMain.handle(IPC_CHANNELS.voice.playbackResult, (_event, rawPayload: unknown) => {
    player.handlePlaybackResult(PlaybackResultSchema.parse(rawPayload));
  });
}
