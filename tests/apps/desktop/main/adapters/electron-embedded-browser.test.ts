/* Verifies Electron embedded-browser profile isolation, security options, and bounded snapshots. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindowConstructorOptions } from 'electron';
import {
  createElectronEmbeddedBrowser,
  embeddedBrowserWindowOptions,
} from '../../../../../apps/desktop/src/main/adapters/embedded-browser/electron-embedded-browser';

describe('Electron embedded browser', () => {
  it('uses isolated persistent profiles with hardened webPreferences', () => {
    expect(embeddedBrowserWindowOptions('xiaohongshu', false)).toMatchObject({
      show: false,
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
    executeJavaScript: vi.fn(async () => ({
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
