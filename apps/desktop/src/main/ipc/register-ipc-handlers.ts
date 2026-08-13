/*
 * Registers Desktop Main IPC channels with host-interface controllers and shell adapters.
 */
import { registerWindowHandlers } from './handlers/window.handler';
import { registerWorkspaceHandlers, type WorkspaceHandlersService } from './handlers/workspace.handler';
import { registerSessionHandlers, type SessionHandlersService } from './handlers/session.handler';
import { registerSkillHandlers, type SkillHandlersService } from './handlers/skill.handler';
import { registerSettingsHandlers, type SettingsHandlersService } from './handlers/settings.handler';
import { registerApprovalHandlers, type ApprovalHandlersService } from './handlers/approval.handler';
import type { ProductRuntimeLogger } from '@megumi/product';
import { registerObservabilityHandlers } from './handlers/observability.handler';
import { registerVoiceHandlers, type VoiceHandlersService } from './handlers/voice.handler';
import { registerCharacterHandlers } from './handlers/character.handler';
import type { CharacterWindowController } from '../app/character-window-controller';
import { registerVoiceInputHandler } from './handlers/voice-input.handler';
import type { ElectronVoiceInputAdapter } from '../adapters/voice-input/electron-voice-input-adapter';
import { registerVoicePlaybackHandler } from './handlers/voice-playback.handler';
import type { CharacterSpeechPlayerAdapter } from '../adapters/character-speech-player-adapter';
import { electronIpcMain, type DesktopIpcMain } from '../adapters/electron-ipc-main-adapter';

export interface RegisterAllHandlersOptions {
  logger?: ProductRuntimeLogger;
  ipcMain?: DesktopIpcMain;
  workspace?: WorkspaceHandlersService;
  session?: SessionHandlersService;
  skill?: SkillHandlersService;
  settings?: SettingsHandlersService;
  approval?: ApprovalHandlersService;
  observability?: { host: Pick<import('@megumi/product/host').ProductHostInterface, 'observability'> };
  voice?: VoiceHandlersService;
  character?: CharacterWindowController;
  speechPlayer?: CharacterSpeechPlayerAdapter;
  voiceInput?: { adapter: ElectronVoiceInputAdapter };
}

export function registerAllHandlers(options: RegisterAllHandlersOptions = {}): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  registerWindowHandlers({ ipcMain });

  if (options.workspace) {
    registerWorkspaceHandlers(options.workspace, { logger: options.logger, ipcMain });
  }

  if (options.session) {
    registerSessionHandlers(options.session, { logger: options.logger, ipcMain });
  }

  if (options.skill) {
    registerSkillHandlers(options.skill, { logger: options.logger, ipcMain });
  }

  if (options.settings) {
    registerSettingsHandlers(options.settings, { logger: options.logger, ipcMain });
  }

  if (options.approval) {
    registerApprovalHandlers(options.approval, { logger: options.logger, ipcMain });
  }

  if (options.observability) {
    registerObservabilityHandlers(options.observability, { logger: options.logger, ipcMain });
  }

  if (options.voice) {
    registerVoiceHandlers(options.voice, { logger: options.logger, ipcMain });
  }

  if (options.character) {
    registerCharacterHandlers({ controller: options.character, ipcMain });
  }

  if (options.speechPlayer) {
    registerVoicePlaybackHandler(options.speechPlayer, ipcMain);
  }

  if (options.voiceInput) {
    registerVoiceInputHandler({ adapter: options.voiceInput.adapter }, { ipcMain });
  }

}
