import { IPC_CHANNELS } from './channels';
import type { BusinessIpcChannel } from '@megumi/desktop/main/ipc/contracts';

export function rendererRuntimeOperationNameFromChannel(channel: BusinessIpcChannel): string {
  switch (channel) {
    case IPC_CHANNELS.settings.providerList:
      return 'provider.list';
    case IPC_CHANNELS.settings.providerUpdate:
      return 'provider.update';
    case IPC_CHANNELS.settings.providerSetApiKey:
      return 'provider.set-api-key';
    case IPC_CHANNELS.settings.providerDeleteApiKey:
      return 'provider.delete-api-key';
    case IPC_CHANNELS.settings.get:
      return 'settings.get';
    case IPC_CHANNELS.settings.update:
      return 'settings.update';
    case IPC_CHANNELS.chat.commandSuggestions:
      return 'command.suggestions';
    case IPC_CHANNELS.chat.sessionCreate:
      return 'session.create';
    case IPC_CHANNELS.chat.sessionList:
      return 'session.list';
    case IPC_CHANNELS.chat.sessionMessageList:
      return 'session.message.list';
    case IPC_CHANNELS.chat.sessionMessageSend:
      return 'session.message.send';
    case IPC_CHANNELS.chat.sessionMessageCancel:
      return 'session.message.cancel';
    case IPC_CHANNELS.chat.sessionTimelineList:
      return 'session.timeline.list';
    case IPC_CHANNELS.chat.branchDraftCreate:
      return 'session.branch-draft.create';
    case IPC_CHANNELS.chat.branchDraftCancel:
      return 'session.branch-draft.cancel';
    case IPC_CHANNELS.chat.runListBySession:
      return 'run.list-by-session';
    case IPC_CHANNELS.chat.runEventsList:
      return 'run.events.list';
    case IPC_CHANNELS.artifacts.planByRunGet:
      return 'plan.by-run.get';
    case IPC_CHANNELS.artifacts.planStatusUpdate:
      return 'plan.status.update';
    case IPC_CHANNELS.approval.resolve:
      return 'approval.resolve';
    case IPC_CHANNELS.artifacts.listByRun:
      return 'artifacts.list-by-run';
    case IPC_CHANNELS.artifacts.listBySession:
      return 'artifacts.list-by-session';
    case IPC_CHANNELS.artifacts.get:
      return 'artifacts.get';
    case IPC_CHANNELS.artifacts.versionGet:
      return 'artifacts.version.get';
    case IPC_CHANNELS.artifacts.versionCreate:
      return 'artifacts.version.create';
    case IPC_CHANNELS.artifacts.statusUpdate:
      return 'artifacts.status.update';
    case IPC_CHANNELS.artifacts.reference:
      return 'artifacts.reference';
    case IPC_CHANNELS.workspace.projectList:
      return 'project.list';
    case IPC_CHANNELS.workspace.projectUseExisting:
      return 'project.use-existing';
    case IPC_CHANNELS.workspace.projectOpen:
      return 'project.open';
    case IPC_CHANNELS.workspace.projectRemove:
      return 'project.remove';
    case IPC_CHANNELS.workspace.filesList:
      return 'workspace.files.list';
    case IPC_CHANNELS.workspace.filesOpen:
      return 'workspace.files.open';
    default:
      return (channel as string).replaceAll(':', '.');
  }
}
