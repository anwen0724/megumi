// @vitest-environment node
import { expectTypeOf, describe, it } from 'vitest';
import type { MegumiAPI } from '@megumi/desktop/preload/types';
import type {
  ProjectListData,
  ProjectListPayload,
  ProjectOpenData,
  ProjectOpenPayload,
  ProjectRemoveData,
  ProjectRemovePayload,
  ProjectUseExistingData,
  ProjectUseExistingPayload,
} from '@megumi/shared/project-contracts';
import type { RuntimeIpcRequest, RuntimeIpcResult } from '@megumi/shared/ipc-contracts';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';

describe('project preload types', () => {
  it('exposes typed project API methods', () => {
    expectTypeOf<MegumiAPI['project']['list']>().parameters.toEqualTypeOf<[
      RuntimeIpcRequest<ProjectListPayload, typeof IPC_CHANNELS.project.list>,
    ]>();
    expectTypeOf<MegumiAPI['project']['list']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<ProjectListData, typeof IPC_CHANNELS.project.list>
    >();

    expectTypeOf<MegumiAPI['project']['useExisting']>().parameters.toEqualTypeOf<[
      RuntimeIpcRequest<ProjectUseExistingPayload, typeof IPC_CHANNELS.project.useExisting>,
    ]>();
    expectTypeOf<MegumiAPI['project']['useExisting']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<ProjectUseExistingData, typeof IPC_CHANNELS.project.useExisting>
    >();

    expectTypeOf<MegumiAPI['project']['open']>().parameters.toEqualTypeOf<[
      RuntimeIpcRequest<ProjectOpenPayload, typeof IPC_CHANNELS.project.open>,
    ]>();
    expectTypeOf<MegumiAPI['project']['open']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<ProjectOpenData, typeof IPC_CHANNELS.project.open>
    >();

    expectTypeOf<MegumiAPI['project']['remove']>().parameters.toEqualTypeOf<[
      RuntimeIpcRequest<ProjectRemovePayload, typeof IPC_CHANNELS.project.remove>,
    ]>();
    expectTypeOf<MegumiAPI['project']['remove']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<ProjectRemoveData, typeof IPC_CHANNELS.project.remove>
    >();
  });
});
