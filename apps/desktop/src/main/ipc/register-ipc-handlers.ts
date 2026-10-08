/*
 * Registers Desktop Main IPC channels with host-interface controllers and shell adapters.
 */
import { registerMemoryHandlers, type MemoryHandlersService } from './handlers/memory.handler';
import { registerModelsHandlers } from './handlers/models.handler';
import { registerToolsHandlers } from './handlers/tools.handler';
import { registerWindowHandlers } from './handlers/window.handler';
import {
  registerWorkspaceHandlers,
  type WorkspaceHandlersService,
} from './handlers/workspace.handler';
import { registerSessionHandlers, type SessionHandlersService } from './handlers/session.handler';
import { registerSkillHandlers, type SkillHandlersService } from './handlers/skill.handler';
import {
  registerSettingsHandlers,
  type SettingsHandlersService,
} from './handlers/settings.handler';
import {
  registerApprovalHandlers,
  type ApprovalHandlersService,
} from './handlers/approval.handler';
import {
  registerDiscoveryHandlers,
  type DiscoveryHandlersService,
} from './handlers/discovery.handler';
import type { DesktopRuntimeLogger as ApplicationLogger } from '../runtime-logger';
import { registerObservabilityHandlers } from './handlers/observability.handler';
import { registerVoiceHandlers, type VoiceHandlersService } from './handlers/voice.handler';
import { registerCharacterHandlers } from './handlers/character.handler';
import type { CharacterWindowController } from '../app/character-window-controller';
import { registerVoiceInputHandler } from './handlers/voice-input.handler';
import type { ElectronVoiceInputAdapter } from '../adapters/voice-input/electron-voice-input-adapter';
import { electronIpcMain, type DesktopIpcMain } from '../adapters/electron-ipc-main-adapter';
import type { SessionMessagePresentationEvent } from './session-message-presentation';
import { registerApplicationUpdateHandlers } from './handlers/application-update.handler';
import type { ApplicationUpdateController } from '../application-update/application-update-controller';
import {
  registerSettingsRecoveryHandlers,
  type SettingsRecoveryService,
} from './handlers/settings-recovery.handler';

export interface RegisterAllHandlersOptions {
  logger?: ApplicationLogger;
  ipcMain?: DesktopIpcMain;
  workspace?: WorkspaceHandlersService;
  session?: SessionHandlersService;
  publishSessionMessageEvent?(event: SessionMessagePresentationEvent): void;
  skill?: SkillHandlersService;
  settings?: SettingsHandlersService & {
    host: Pick<import('@megumi/application/contracts').ApplicationOperations, 'models' | 'tools'>;
  };
  settingsRecovery?: SettingsRecoveryService;
  approval?: ApprovalHandlersService;
  discovery?: DiscoveryHandlersService;
  memory?: MemoryHandlersService;
  observability?: {
    host: Pick<import('@megumi/application/contracts').ApplicationOperations, 'observability'>;
  };
  voice?: VoiceHandlersService;
  character?: CharacterWindowController;
  voiceInput?: { adapter: ElectronVoiceInputAdapter };
  applicationUpdate?: ApplicationUpdateController;
}

export function registerAllHandlers(options: RegisterAllHandlersOptions = {}): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  registerWindowHandlers({ ipcMain });
  if (options.settingsRecovery)
    registerSettingsRecoveryHandlers(options.settingsRecovery, { ipcMain });

  if (options.applicationUpdate) {
    registerApplicationUpdateHandlers({ controller: options.applicationUpdate, ipcMain });
  }

  if (options.workspace) {
    registerWorkspaceHandlers(options.workspace, { logger: options.logger, ipcMain });
  }

  if (options.session) {
    registerSessionHandlers(options.session, {
      logger: options.logger,
      ipcMain,
      publishMessageEvent: options.publishSessionMessageEvent,
    });
  }

  if (options.skill) {
    registerSkillHandlers(options.skill, { logger: options.logger, ipcMain });
  }

  if (options.settings) {
    registerSettingsHandlers(options.settings, { logger: options.logger, ipcMain });
    registerModelsHandlers(options.settings.host, ipcMain);
    registerToolsHandlers(options.settings.host, ipcMain);
  }

  if (options.approval) {
    registerApprovalHandlers(options.approval, { logger: options.logger, ipcMain });
  }

  if (options.memory) {
    registerMemoryHandlers(options.memory, { logger: options.logger, ipcMain });
  }

  if (options.discovery) {
    registerDiscoveryHandlers(options.discovery, { logger: options.logger, ipcMain });
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

  if (options.voiceInput) {
    registerVoiceInputHandler({ adapter: options.voiceInput.adapter }, { ipcMain });
  }
}
