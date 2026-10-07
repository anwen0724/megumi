/* Verifies Electron embedded-browser profile isolation, security options, and bounded snapshots. */
// @vitest-environment jsdom
import path from 'node:path';
import { describe, expect, it, vi, onTestFinished } from 'vitest';
import type { BrowserWindowConstructorOptions } from 'electron';
import {
  createElectronEmbeddedBrowser,
  embeddedBrowserWindowOptions,
} from '../../../../../apps/desktop/src/main/adapters/embedded-browser/electron-embedded-browser';
const { profileFetch } = vi.hoisted(() => ({ profileFetch: vi.fn() }));

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
  BrowserWindow: vi.fn(),
  session: { fromPartition: vi.fn(() => ({ fetch: profileFetch })) },
}));

describe('Electron embedded browser', () => {
  it('cancels a task queued behind the same platform without waiting for the active task', async () => {
    const window = new FakeWindow(embeddedBrowserWindowOptions('zhihu', false));
    let started: () => void = () => undefined;
    const loading = new Promise<void>((resolve) => { started = resolve; });
    window.loadURL.mockImplementationOnce(async () => { started(); return new Promise<void>(() => undefined); });
    const browser = createElectronEmbeddedBrowser({ createWindow: () => window as never });
    const activeController = new AbortController();
    const active = browser.readPlatform({ profileId: 'zhihu', operation: 'search', url: 'https://www.zhihu.com/search?q=test', signal: activeController.signal });
    onTestFinished(async () => { activeController.abort(); await active; await browser.shutdown(); });
    await loading;
    const queuedController = new AbortController();
    const queued = browser.readPlatform({ profileId: 'zhihu', operation: 'detail', url: 'https://zhuanlan.zhihu.com/p/1', signal: queuedController.signal });
    queuedController.abort();
    expect(await queued).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });
    expect(window.isDestroyed()).toBe(false);
  }, 1000);
  it('retains the acquired Unicode range and reports truncation for platform detail', async () => {
    const window = new FakeWindow(embeddedBrowserWindowOptions('xiaohongshu', false));
    window.webContents.executeJavaScript.mockResolvedValue({ finalUrl: 'https://www.xiaohongshu.com/explore/note1', bodyText: '🌏'.repeat(50_001), links: [] });
    const browser = createElectronEmbeddedBrowser({ createWindow: () => window as never });
    const result = await browser.readPlatform({ profileId: 'xiaohongshu', operation: 'detail', url: 'https://www.xiaohongshu.com/explore/note1', signal: new AbortController().signal });
    expect(result.status).toBe('success');
    if (result.status !== 'success') throw new Error('Expected material');
    expect([...result.snapshot.bodyText]).toHaveLength(50_000);
    expect(result.snapshot).toMatchObject({ truncated: true });
    expect(window.isDestroyed()).toBe(true);
    await browser.shutdown();
  });

  it('rejects oversized structured material and releases the temporary window', async () => {
    const window = new FakeWindow(embeddedBrowserWindowOptions('xiaohongshu', false));
    window.webContents.executeJavaScript.mockResolvedValue({ finalUrl: 'https://www.xiaohongshu.com/explore/note1', bodyText: '', links: [], structuredData: { note: { desc: 'x'.repeat(2 * 1024 * 1024) } } });
    const browser = createElectronEmbeddedBrowser({ createWindow: () => window as never });
    expect(await browser.readPlatform({ profileId: 'xiaohongshu', operation: 'detail', url: 'https://www.xiaohongshu.com/explore/note1', signal: new AbortController().signal })).toMatchObject({ status: 'failed', failure: { code: 'material_too_large' } });
    expect(window.isDestroyed()).toBe(true);
    await browser.shutdown();
  });
  it('uses the Bilibili session only for approved read endpoints', async () => {
    profileFetch.mockResolvedValueOnce(Response.json({ code: 0, data: { isLogin: false } }));
    const browser = createElectronEmbeddedBrowser();
    const response = await browser.fetchWithSession({ profileId: 'bilibili', url: 'https://api.bilibili.com/x/web-interface/nav' });
    expect(await response.json()).toMatchObject({ code: 0 });
    await expect(browser.fetchWithSession({ profileId: 'bilibili', url: 'https://api.bilibili.com/x/web-interface/coin/add' })).rejects.toThrow();
    await expect(browser.fetchWithSession({ profileId: 'bilibili', url: 'https://evil.example/x/web-interface/nav' })).rejects.toThrow();
    await browser.shutdown();
  });
  it('keeps at most two platform task windows active and cancels a queued task', async () => {
    const controllers = [new AbortController(), new AbortController(), new AbortController()];
    const windows: FakeWindow[] = [];
    let notifyStarted: () => void = () => undefined;
    const twoStarted = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const browser = createElectronEmbeddedBrowser({ createWindow: (options) => {
      const window = new FakeWindow(options);
      windows.push(window);
      window.loadURL.mockImplementationOnce(async () => { if (windows.length === 2) notifyStarted(); await new Promise(() => undefined); });
      return window as never;
    } });
    const profiles = ['zhihu', 'bilibili', 'xiaohongshu'] as const;
    const urls = ['https://www.zhihu.com/', 'https://www.bilibili.com/', 'https://www.xiaohongshu.com/'];
    const tasks = profiles.map((profileId, index) => browser.readPlatform({ profileId, operation: 'status', url: urls[index]!, signal: controllers[index]!.signal }));
    try {
      await twoStarted;
      expect(windows).toHaveLength(2);
    } finally {
      controllers.forEach((controller) => controller.abort());
      await Promise.all(tasks);
      await browser.shutdown();
    }
    expect(windows).toHaveLength(2);
  });
  it('returns the login handle before the user closes the window', async () => {
    const window = new FakeWindow(embeddedBrowserWindowOptions('zhihu', true));
    const browser = createElectronEmbeddedBrowser({ createWindow: () => window as never });
    const handle = await browser.openLogin({ profileId: 'zhihu', url: 'https://www.zhihu.com/', allowedOrigins: ['https://www.zhihu.com'] });
    expect(window.show).toHaveBeenCalled();
    expect(window.isDestroyed()).toBe(false);
    expect(handle).toHaveProperty('closed');
    window.closedHandler?.();
    await browser.shutdown();
  }, 1000);

  it('completes cancellation while navigation is pending and releases the task window', async () => {
    const window = new FakeWindow(embeddedBrowserWindowOptions('zhihu', false));
    const controller = new AbortController();
    window.loadURL.mockImplementationOnce(async () => { controller.abort(); await new Promise(() => undefined); });
    const browser = createElectronEmbeddedBrowser({ createWindow: () => window as never });
    const task = browser.readPlatform({ profileId: 'zhihu', operation: 'detail', url: 'https://www.zhihu.com/question/1/answer/2', signal: controller.signal });
    expect(await task).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });
    expect(window.destroy).toHaveBeenCalled();
    await browser.shutdown();
  }, 1000);
  it('reads a hidden search response even when the page has no rendered cards', async () => {
    const window = new FakeWindow(embeddedBrowserWindowOptions('xiaohongshu', false));
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const debuggerPort = {
      attach: vi.fn(), detach: vi.fn(),
      on: vi.fn((name: string, callback: (...args: unknown[]) => void) => { listeners.set(name, callback); }),
      removeListener: vi.fn((name: string) => { listeners.delete(name); }),
      sendCommand: vi.fn(async (method: string) => method === 'Network.getResponseBody' ? { body: '{"success":true,"data":{"items":[{"id":"note1"}]}}', base64Encoded: false } : {}),
    };
    Object.assign(window.webContents, { debugger: debuggerPort });
    window.loadURL.mockImplementationOnce(async () => {
      listeners.get('message')?.({}, 'Network.responseReceived', { requestId: 'r1', response: { url: 'https://www.xiaohongshu.com/api/sns/web/v2/search/notes', status: 200 } });
      listeners.get('message')?.({}, 'Network.loadingFinished', { requestId: 'r1', encodedDataLength: 100 });
    });
    const browser = createElectronEmbeddedBrowser({ createWindow: () => window as never, settleDelayMs: 0 });
    const result = await browser.readPlatform({ profileId: 'xiaohongshu', operation: 'search', url: 'https://www.xiaohongshu.com/search_result?keyword=React', signal: new AbortController().signal });
    expect(result).toMatchObject({ status: 'success', snapshot: { responses: [{ status: 200, body: '{"success":true,"data":{"items":[{"id":"note1"}]}}' }] } });
    expect(window.options.show).toBe(false);
    expect(window.destroy).toHaveBeenCalled();
    expect(debuggerPort.detach).toHaveBeenCalled();
    expect(listeners.size).toBe(0);
    await browser.shutdown();
  });
  it('uses isolated persistent profiles with hardened webPreferences', () => {
    expect(embeddedBrowserWindowOptions('xiaohongshu', false)).toMatchObject({
      show: false,
      icon: path.resolve('apps/desktop/assets/app-icon.ico'),
      webPreferences: {
        partition: 'persist:megumi-discovery-xiaohongshu',
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    expect(embeddedBrowserWindowOptions('douyin', true).webPreferences?.partition)
      .toBe('persist:megumi-discovery-douyin');
  });

  it('opens visible login windows and reuses each profile window', async () => {
    const windows: FakeWindow[] = [];
    const browser = createElectronEmbeddedBrowser({
      createWindow: (options) => {
        const window = new FakeWindow(options);
        windows.push(window);
        return window as never;
      },
      settleDelayMs: 0,
    });
    const request = {
      profileId: 'xiaohongshu' as const,
      url: 'https://www.xiaohongshu.com/',
      allowedOrigins: ['https://www.xiaohongshu.com'],
    };
    const first = browser.openLogin(request);
    const second = browser.openLogin(request);
    await Promise.resolve();

    expect(windows).toHaveLength(1);
    expect(windows[0]!.options.show).toBe(true);
    expect(windows[0]!.show).toHaveBeenCalledTimes(2);
    expect(windows[0]!.focus).toHaveBeenCalledTimes(1);
    expect(windows[0]!.webContents.setAudioMuted).not.toHaveBeenCalled();
    windows[0]!.closedHandler?.();
    await Promise.all([first, second]);
    await browser.shutdown();
  });

  it('returns only the fixed document snapshot and destroys the temporary page', async () => {
    const window = new FakeWindow(embeddedBrowserWindowOptions('douyin', false));
    window.webContents.executeJavaScript.mockResolvedValue({
      finalUrl: 'https://www.douyin.com/search/Agent', title: 'Search', bodyText: 'Body',
      links: [{ href: '/video/1', text: 'Result', contextText: 'Context', imageUrl: 'https://img.example/1.jpg' }],
      cookies: 'must-not-pass',
    });
    const browser = createElectronEmbeddedBrowser({ createWindow: () => window as never, settleDelayMs: 0 });
    const result = await browser.snapshot({
      profileId: 'douyin', url: 'https://www.douyin.com/search/Agent',
      allowedOrigins: ['https://www.douyin.com'], signal: new AbortController().signal,
    });

    expect(result).toEqual({ status: 'success', snapshot: {
      finalUrl: 'https://www.douyin.com/search/Agent', title: 'Search', bodyText: 'Body',
      links: [{
        href: 'https://www.douyin.com/video/1', text: 'Result', contextText: 'Context',
        imageUrl: 'https://img.example/1.jpg',
      }],
    } });
    expect(JSON.stringify(result)).not.toContain('must-not-pass');
    expect(window.webContents.setAudioMuted).toHaveBeenCalledWith(true);
    expect(window.webContents.setAudioMuted.mock.invocationCallOrder[0])
      .toBeLessThan(window.loadURL.mock.invocationCallOrder[0]!);
    expect(window.webContents.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('querySelectorAll'), true);
    expect(window.destroy).toHaveBeenCalled();
  });

  it('blocks top-level and frame navigation outside the Source allowlist and honors cancellation', async () => {
    const window = new FakeWindow(embeddedBrowserWindowOptions('xiaohongshu', false));
    const browser = createElectronEmbeddedBrowser({ createWindow: () => window as never, settleDelayMs: 0 });
    const controller = new AbortController();
    controller.abort();
    await expect(browser.snapshot({
      profileId: 'xiaohongshu', url: 'https://www.xiaohongshu.com/search_result?keyword=Agent',
      allowedOrigins: ['https://www.xiaohongshu.com'], signal: controller.signal,
    })).resolves.toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });

    const active = createElectronEmbeddedBrowser({ createWindow: () => window as never, settleDelayMs: 0 });
    const promise = active.snapshot({
      profileId: 'xiaohongshu', url: 'https://www.xiaohongshu.com/search_result?keyword=Agent',
      allowedOrigins: ['https://www.xiaohongshu.com'], signal: new AbortController().signal,
    });
    await promise;
    const event = { preventDefault: vi.fn() };
    window.navigationHandler?.(event, 'https://evil.example/steal');
    expect(event.preventDefault).toHaveBeenCalled();

    const customProtocolEvent = { preventDefault: vi.fn(), url: 'bytedance://launch' };
    window.frameNavigationHandler?.(customProtocolEvent);
    expect(customProtocolEvent.preventDefault).toHaveBeenCalled();

    const allowedFrameEvent = { preventDefault: vi.fn(), url: 'https://www.xiaohongshu.com/explore' };
    window.frameNavigationHandler?.(allowedFrameEvent);
    expect(allowedFrameEvent.preventDefault).not.toHaveBeenCalled();
    expect(window.webContents.setWindowOpenHandler()).toEqual({ action: 'deny' });
  });
});

class FakeWindow {
  readonly loadURL = vi.fn(async () => undefined);
  readonly show = vi.fn();
  readonly focus = vi.fn();
  readonly destroy = vi.fn(() => { this.destroyed = true; });
  readonly isDestroyed = vi.fn(() => this.destroyed);
  readonly once = vi.fn((event: string, listener: () => void) => {
    if (event === 'closed') this.closedHandler = listener;
  });
  readonly webContents = {
    stop: vi.fn(),
    setAudioMuted: vi.fn(),
    executeJavaScript: vi.fn(async (_script: string, _userGesture: boolean): Promise<unknown> => ({
      finalUrl: 'https://www.xiaohongshu.com/', bodyText: '', links: [],
    })),
    setWindowOpenHandler: vi.fn((handler?: () => unknown) => handler ? handler() : { action: 'deny' }),
    on: vi.fn((event: string, listener: FakeNavigationHandler) => {
      if (event === 'will-navigate') this.navigationHandler = listener;
      if (event === 'will-frame-navigate') this.frameNavigationHandler = listener;
    }),
  };
  navigationHandler?: FakeNavigationHandler;
  frameNavigationHandler?: FakeNavigationHandler;
  closedHandler?: () => void;
  private destroyed = false;

  constructor(readonly options: BrowserWindowConstructorOptions) {}
}

type FakeNavigationHandler = (
  event: { preventDefault(): void; readonly url?: string },
  url?: string,
) => void;
