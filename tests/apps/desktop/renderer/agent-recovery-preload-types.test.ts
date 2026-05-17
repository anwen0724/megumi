import { describe, expectTypeOf, it } from 'vitest';

import type { MegumiAPI } from '@megumi/desktop/preload/types';
import type { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest, RuntimeIpcResult } from '@megumi/shared/ipc-contracts';
import type {
  AgentRecoverableRunListData,
  AgentRecoverableRunListPayload,
  AgentRunCancelData,
  AgentRunCancelPayload,
  AgentRunResumeData,
  AgentRunResumePayload,
  AgentRunRetryData,
  AgentRunRetryPayload,
  RecoverableRunListData,
  RecoverableRunListPayload,
  RunResumeData,
  RunResumePayload,
} from '@megumi/shared/ipc-schemas';

describe('agent recovery preload types', () => {
  it('exposes primary recovery controls under window.megumi', () => {
    expectTypeOf<MegumiAPI['recovery']['listRecoverableRuns']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<RecoverableRunListData, typeof IPC_CHANNELS.recovery.recoverableRunsList>
    >();
    expectTypeOf<Parameters<MegumiAPI['recovery']['listRecoverableRuns']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<RecoverableRunListPayload, typeof IPC_CHANNELS.recovery.recoverableRunsList>
    >();
    expectTypeOf<MegumiAPI['recovery']['resume']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<RunResumeData, typeof IPC_CHANNELS.recovery.resume>
    >();
    expectTypeOf<Parameters<MegumiAPI['recovery']['resume']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<RunResumePayload, typeof IPC_CHANNELS.recovery.resume>
    >();
  });

  it('keeps deprecated agent recovery controls as migration bridge', () => {
    expectTypeOf<MegumiAPI['agent']['recovery']['listRecoverableRuns']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<AgentRecoverableRunListData, typeof IPC_CHANNELS.agent.recovery.recoverableRunsList>
    >();
    expectTypeOf<Parameters<MegumiAPI['agent']['recovery']['listRecoverableRuns']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<AgentRecoverableRunListPayload, typeof IPC_CHANNELS.agent.recovery.recoverableRunsList>
    >();
    expectTypeOf<MegumiAPI['agent']['recovery']['resume']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<AgentRunResumeData, typeof IPC_CHANNELS.agent.recovery.resume>
    >();
    expectTypeOf<Parameters<MegumiAPI['agent']['recovery']['resume']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<AgentRunResumePayload, typeof IPC_CHANNELS.agent.recovery.resume>
    >();
    expectTypeOf<MegumiAPI['agent']['recovery']['cancel']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<AgentRunCancelData, typeof IPC_CHANNELS.agent.recovery.cancel>
    >();
    expectTypeOf<Parameters<MegumiAPI['agent']['recovery']['cancel']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<AgentRunCancelPayload, typeof IPC_CHANNELS.agent.recovery.cancel>
    >();
    expectTypeOf<MegumiAPI['agent']['recovery']['retry']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<AgentRunRetryData, typeof IPC_CHANNELS.agent.recovery.retry>
    >();
    expectTypeOf<Parameters<MegumiAPI['agent']['recovery']['retry']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<AgentRunRetryPayload, typeof IPC_CHANNELS.agent.recovery.retry>
    >();
  });
});
