import { describe, expectTypeOf, it } from 'vitest';
import type { MegumiAPI } from '@megumi/desktop/preload/types';
import type { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type {
  AgentApprovalResolveData,
  AgentApprovalResolvePayload,
  AgentToolDefinitionsListData,
  AgentToolDefinitionsListPayload,
  ApprovalResolveData,
  ApprovalResolvePayload,
  ToolDefinitionsListData,
  ToolDefinitionsListPayload,
} from '@megumi/shared/ipc-schemas';
import type { RuntimeIpcRequest, RuntimeIpcResult } from '@megumi/shared/ipc-contracts';

describe('agent tool preload types', () => {
  it('exposes primary tool definitions and approval resolve APIs', () => {
    expectTypeOf<MegumiAPI['tool']['definitionsList']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<ToolDefinitionsListData, typeof IPC_CHANNELS.tool.definitionsList>
    >();
    expectTypeOf<Parameters<MegumiAPI['tool']['definitionsList']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<ToolDefinitionsListPayload, typeof IPC_CHANNELS.tool.definitionsList>
    >();
    expectTypeOf<MegumiAPI['approval']['resolve']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<ApprovalResolveData, typeof IPC_CHANNELS.approval.resolve>
    >();
    expectTypeOf<Parameters<MegumiAPI['approval']['resolve']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<ApprovalResolvePayload, typeof IPC_CHANNELS.approval.resolve>
    >();
  });

  it('keeps deprecated agent tool and approval APIs as migration bridge', () => {
    expectTypeOf<MegumiAPI['agent']['tool']['definitionsList']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<AgentToolDefinitionsListData, typeof IPC_CHANNELS.agent.tool.definitionsList>
    >();
    expectTypeOf<Parameters<MegumiAPI['agent']['tool']['definitionsList']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<AgentToolDefinitionsListPayload, typeof IPC_CHANNELS.agent.tool.definitionsList>
    >();
    expectTypeOf<MegumiAPI['agent']['approval']['resolve']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<AgentApprovalResolveData, typeof IPC_CHANNELS.agent.approval.resolve>
    >();
    expectTypeOf<Parameters<MegumiAPI['agent']['approval']['resolve']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<AgentApprovalResolvePayload, typeof IPC_CHANNELS.agent.approval.resolve>
    >();
  });
});
