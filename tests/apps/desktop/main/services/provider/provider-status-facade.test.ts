// @vitest-environment node
// Verifies the desktop provider-status facade delegates to the product runtime's
// provider settings service, giving the provider IPC handler a desktop-owned
// adapter (the provider/ directory's UI facade home) instead of binding to the
// product class directly.
import { describe, expect, it, vi } from 'vitest';
import { createDesktopProviderStatusService } from '@megumi/desktop/main/services/provider/provider-status-facade';

function stubProviderSettingsService() {
  return {
    getProviderSettings: vi.fn(async () => ({ providerId: 'deepseek' })),
    listProviderStatuses: vi.fn(async () => [{ providerId: 'deepseek', configured: true }]),
    updateProviderSettings: vi.fn(async () => ({ providerId: 'deepseek' })),
    setProviderApiKey: vi.fn(async () => ({ providerId: 'deepseek' })),
    deleteProviderApiKey: vi.fn(async () => ({ providerId: 'deepseek' })),
  };
}

describe('desktop provider-status facade', () => {
  it('delegates listProviderStatuses to the runtime provider settings service', async () => {
    const runtime = stubProviderSettingsService();
    const service = createDesktopProviderStatusService(runtime as never);
    expect(await service.listProviderStatuses()).toEqual([{ providerId: 'deepseek', configured: true }]);
    expect(runtime.listProviderStatuses).toHaveBeenCalledOnce();
  });

  it('delegates getProviderSettings to the runtime', async () => {
    const runtime = stubProviderSettingsService();
    const service = createDesktopProviderStatusService(runtime as never);
    expect(await service.getProviderSettings('deepseek' as never)).toEqual({ providerId: 'deepseek' });
    expect(runtime.getProviderSettings).toHaveBeenCalledWith('deepseek');
  });

  it('delegates updateProviderSettings to the runtime', async () => {
    const runtime = stubProviderSettingsService();
    const service = createDesktopProviderStatusService(runtime as never);
    await service.updateProviderSettings('deepseek' as never, { providerId: 'deepseek' } as never);
    expect(runtime.updateProviderSettings).toHaveBeenCalledWith('deepseek', { providerId: 'deepseek' });
  });

  it('delegates setProviderApiKey and deleteProviderApiKey to the runtime', async () => {
    const runtime = stubProviderSettingsService();
    const service = createDesktopProviderStatusService(runtime as never);
    await service.setProviderApiKey('deepseek' as never, 'sk-test');
    expect(runtime.setProviderApiKey).toHaveBeenCalledWith('deepseek', 'sk-test');
    await service.deleteProviderApiKey('deepseek' as never);
    expect(runtime.deleteProviderApiKey).toHaveBeenCalledWith('deepseek');
  });
});
