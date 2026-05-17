import { describe, expectTypeOf, it } from 'vitest';

import type { MegumiAPI } from '@megumi/desktop/preload/types';
import type { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest, RuntimeIpcResult } from '@megumi/shared/ipc-contracts';
import type {
  MemoryCandidateAcceptData,
  MemoryCandidateAcceptPayload,
  MemoryListData,
  MemoryListPayload,
  MemoryRecallPreviewData,
  MemoryRecallPreviewPayload,
  MemorySettingsData,
  MemorySettingsGetPayload,
} from '@megumi/shared/ipc-schemas';

describe('memory preload types', () => {
  it('exposes primary memory API under window.megumi.memory', () => {
    expectTypeOf<MegumiAPI['memory']['settingsGet']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<MemorySettingsData, typeof IPC_CHANNELS.memory.settingsGet>
    >();
    expectTypeOf<Parameters<MegumiAPI['memory']['settingsGet']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<MemorySettingsGetPayload, typeof IPC_CHANNELS.memory.settingsGet>
    >();
    expectTypeOf<MegumiAPI['memory']['candidateAccept']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<MemoryCandidateAcceptData, typeof IPC_CHANNELS.memory.candidateAccept>
    >();
    expectTypeOf<Parameters<MegumiAPI['memory']['candidateAccept']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<MemoryCandidateAcceptPayload, typeof IPC_CHANNELS.memory.candidateAccept>
    >();
    expectTypeOf<MegumiAPI['memory']['memoryList']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<MemoryListData, typeof IPC_CHANNELS.memory.memoryList>
    >();
    expectTypeOf<Parameters<MegumiAPI['memory']['memoryList']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<MemoryListPayload, typeof IPC_CHANNELS.memory.memoryList>
    >();
    expectTypeOf<MegumiAPI['memory']['recallPreview']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<MemoryRecallPreviewData, typeof IPC_CHANNELS.memory.recallPreview>
    >();
    expectTypeOf<Parameters<MegumiAPI['memory']['recallPreview']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<MemoryRecallPreviewPayload, typeof IPC_CHANNELS.memory.recallPreview>
    >();
  });
});
