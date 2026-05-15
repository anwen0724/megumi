import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { BusinessIpcChannel } from '@megumi/shared/ipc-contracts';

export function rendererRuntimeOperationNameFromChannel(channel: BusinessIpcChannel): string {
  switch (channel) {
    case IPC_CHANNELS.provider.list:
      return 'provider.list';
    case IPC_CHANNELS.provider.update:
      return 'provider.update';
    case IPC_CHANNELS.provider.setApiKey:
      return 'provider.set-api-key';
    case IPC_CHANNELS.provider.deleteApiKey:
      return 'provider.delete-api-key';
    case IPC_CHANNELS.chat.start:
      return 'chat.start';
    case IPC_CHANNELS.chat.cancel:
      return 'chat.cancel';
    case IPC_CHANNELS.agent.session.create:
      return 'agent.session.create';
    case IPC_CHANNELS.agent.session.list:
      return 'agent.session.list';
    case IPC_CHANNELS.agent.run.start:
      return 'agent.run.start';
    default: {
      const exhaustive: never = channel;
      return exhaustive;
    }
  }
}
