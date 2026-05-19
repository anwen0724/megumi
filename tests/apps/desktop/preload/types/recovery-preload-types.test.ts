// @vitest-environment node
import { describe, expectTypeOf, it } from 'vitest';

import type { MegumiAPI } from '@megumi/desktop/preload/types';
import type { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest, RuntimeIpcResult } from '@megumi/shared/ipc-contracts';
import type {
  RecoverableRunListData,
  RecoverableRunListPayload,
  RunCancelData,
  RunCancelPayload,
  RunResumeData,
  RunResumePayload,
  RunRetryData,
  RunRetryPayload,
} from '@megumi/shared/ipc-schemas';

describe('recovery preload types', () => {
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
    expectTypeOf<MegumiAPI['recovery']['cancel']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<RunCancelData, typeof IPC_CHANNELS.recovery.cancel>
    >();
    expectTypeOf<Parameters<MegumiAPI['recovery']['cancel']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<RunCancelPayload, typeof IPC_CHANNELS.recovery.cancel>
    >();
    expectTypeOf<MegumiAPI['recovery']['retry']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<RunRetryData, typeof IPC_CHANNELS.recovery.retry>
    >();
    expectTypeOf<Parameters<MegumiAPI['recovery']['retry']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<RunRetryPayload, typeof IPC_CHANNELS.recovery.retry>
    >();
  });
});
