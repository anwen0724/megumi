import { describe, expectTypeOf, it } from 'vitest';
import type { RuntimeIpcResult, RuntimeIpcRequest } from '@megumi/shared/ipc';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type {
  SettingsData,
  SettingsGetPayload,
  SettingsUpdatePayload,
} from '@megumi/shared/ipc';
import type { MegumiAPI } from '@megumi/desktop/preload/types';

describe('settings preload types', () => {
  it('exposes typed app settings API under window.megumi.settings', () => {
    expectTypeOf<MegumiAPI['settings']['get']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<SettingsData, typeof IPC_CHANNELS.settings.get>
    >();
    expectTypeOf<Parameters<MegumiAPI['settings']['get']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<SettingsGetPayload, typeof IPC_CHANNELS.settings.get>
    >();
    expectTypeOf<MegumiAPI['settings']['update']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<SettingsData, typeof IPC_CHANNELS.settings.update>
    >();
    expectTypeOf<Parameters<MegumiAPI['settings']['update']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<SettingsUpdatePayload, typeof IPC_CHANNELS.settings.update>
    >();
  });
});
