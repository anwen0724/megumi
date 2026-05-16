import { describe, expectTypeOf, it } from 'vitest';

import type { MegumiAPI } from '@megumi/desktop/preload/types';
import type { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest, RuntimeIpcResult } from '@megumi/shared/ipc-contracts';
import type {
  AgentMemoryCandidateAcceptData,
  AgentMemoryCandidateAcceptPayload,
  AgentMemoryListData,
  AgentMemoryListPayload,
  AgentMemoryRecallPreviewData,
  AgentMemoryRecallPreviewPayload,
  AgentMemorySettingsData,
  AgentMemorySettingsGetPayload,
} from '@megumi/shared/ipc-schemas';

describe('agent memory preload types', () => {
  it('exposes memory API under window.megumi.agent.memory', () => {
    expectTypeOf<MegumiAPI['agent']['memory']['settingsGet']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<AgentMemorySettingsData, typeof IPC_CHANNELS.agent.memory.settingsGet>
    >();
    expectTypeOf<Parameters<MegumiAPI['agent']['memory']['settingsGet']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<AgentMemorySettingsGetPayload, typeof IPC_CHANNELS.agent.memory.settingsGet>
    >();
    expectTypeOf<MegumiAPI['agent']['memory']['candidateAccept']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<AgentMemoryCandidateAcceptData, typeof IPC_CHANNELS.agent.memory.candidateAccept>
    >();
    expectTypeOf<Parameters<MegumiAPI['agent']['memory']['candidateAccept']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<AgentMemoryCandidateAcceptPayload, typeof IPC_CHANNELS.agent.memory.candidateAccept>
    >();
    expectTypeOf<MegumiAPI['agent']['memory']['memoryList']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<AgentMemoryListData, typeof IPC_CHANNELS.agent.memory.memoryList>
    >();
    expectTypeOf<Parameters<MegumiAPI['agent']['memory']['memoryList']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<AgentMemoryListPayload, typeof IPC_CHANNELS.agent.memory.memoryList>
    >();
    expectTypeOf<MegumiAPI['agent']['memory']['recallPreview']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<AgentMemoryRecallPreviewData, typeof IPC_CHANNELS.agent.memory.recallPreview>
    >();
    expectTypeOf<Parameters<MegumiAPI['agent']['memory']['recallPreview']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<AgentMemoryRecallPreviewPayload, typeof IPC_CHANNELS.agent.memory.recallPreview>
    >();
  });
});
