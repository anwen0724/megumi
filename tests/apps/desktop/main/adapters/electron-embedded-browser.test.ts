/* Verifies Electron embedded-browser profile isolation, security options, and bounded snapshots. */
// @vitest-environment jsdom
import { runInNewContext } from 'node:vm';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindowConstructorOptions } from 'electron';
import { createDouyinSource, createXiaohongshuSource } from '@megumi/discovery';
import {
  createElectronEmbeddedBrowser,
  embeddedBrowserWindowOptions,
} from '../../../../../apps/desktop/src/main/adapters/embedded-browser/electron-embedded-browser';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
  BrowserWindow: vi.fn(),
}));

describe('Electron embedded browser', () => {
  it('keeps Xiaohongshu note titles and signed links with the note cover rather than the author avatar', async () => {
    const page = document.implementation.createHTMLDocument('java - 小红书搜索');
    page.body.innerHTML = `<section class="note-item"><div>
      <a href="/explore/69fdfe42000000001f0057b4" style="display:none"></a>
      <a class="cover" href="/search_result/69fdfe42000000001f0057b4?xsec_token=sample"><img src="https://img.example/note.jpg"></a>
      <div class="footer"><a class="title" href="/search_result/69fdfe42000000001f0057b4?xsec_token=sample">Java 入门速成</a>
        <div><a href="/user/profile/author"><img src="https://img.example/avatar.jpg">作者</a></div>
      </div></div></section>`;
    const window = new FakeWindow(embeddedBrowserWindowOptions('xiaohongshu', false));
    window.webContents.executeJavaScript.mockImplementation(async (script) => runInNewContext(script, {
      document: page, location: new URL('https://www.xiaohongshu.com/search_result?keyword=java'),
    }));
    const browser = createElectronEmbeddedBrowser({ createWindow: () => window as never, settleDelayMs: 0 });
    const result = await createXiaohongshuSource({ browser }).search({
      query: 'java', mode: 'relevance', limit: 10, signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ status: 'success', items: [{
      sourceContentId: '69fdfe42000000001f0057b4', title: 'Java 入门速成',
      canonicalUrl: 'https://www.xiaohongshu.com/search_result/69fdfe42000000001f0057b4?xsec_token=sample',
      coverUrl: 'https://img.example/note.jpg',
    }] });
    await browser.shutdown();
  });
  it('extracts Douyin result cards without anchors through the real snapshot and Source boundary', async () => {
    // Minimized structure captured from a verified search page; no account data is retained.
    const page = document.implementation.createHTMLDocument('抖音搜索');
    page.body.innerHTML = '<div id="waterfall_item_7532048589213519162"><div class="search-result-card"><img src="https://img.example/cover.jpg"><div>04:19 2.2万 一期视频速通Java编程基础 #java</div></div></div>';
    const card = page.querySelector('.search-result-card');
    Object.defineProperty(card, '__reactFiber$sample', { enumerable: true, value: {
      memoizedProps: {}, return: { memoizedProps: { data: { awemeInfo: {
        awemeId: '7532048589213519162', desc: '一期视频速通Java编程基础 #java\n',
        authenticationToken: 'must-not-pass', video: {},
      } } } },
    } });
    const window = new FakeWindow(embeddedBrowserWindowOptions('douyin', false));
    window.webContents.executeJavaScript.mockImplementation(async (script) => runInNewContext(script, {
      document: page, location: new URL('https://www.douyin.com/search/java?type=general'),
    }));
    const browser = createElectronEmbeddedBrowser({ createWindow: () => window as never, settleDelayMs: 0 });
    const responses: unknown[] = [];
    const result = await createDouyinSource({ browser }).search({
      query: 'java', mode: 'relevance', limit: 10, signal: new AbortController().signal,
      onProviderResponse: (response) => { responses.push(response); },
    });
    expect(result).toMatchObject({ status: 'success', items: [{
      sourceId: 'douyin', sourceContentId: '7532048589213519162',
      canonicalUrl: 'https://www.douyin.com/video/7532048589213519162',
      title: '一期视频速通Java编程基础 #java', coverUrl: 'https://img.example/cover.jpg',
    }] });
    expect(JSON.stringify(responses)).not.toContain('must-not-pass');
    await browser.shutdown();
  });
  it('allows the actual Douyin verification frame without allowing custom protocols or lookalike hosts', async () => {
    const window = new FakeWindow(embeddedBrowserWindowOptions('douyin', false));
    const browser = createElectronEmbeddedBrowser({ createWindow: () => window as never, settleDelayMs: 0 });
    const observed: { url: string; blocked: boolean }[] = [];
    window.loadURL.mockImplementation(async () => {
      for (const url of [
        'https://rmc.bytedance.com/verifycenter/captcha/v2',
        'https://rmc.bytedance.com.evil.example/verifycenter/captcha/v2',
        'http://rmc.bytedance.com/verifycenter/captcha/v2',
        'bytedance://launch',
      ]) {
        const event = { url, preventDefault: vi.fn() };
        window.frameNavigationHandler?.(event);
        observed.push({ url, blocked: event.preventDefault.mock.calls.length > 0 });
      }
    });
    const source = createDouyinSource({ browser });
    await source.checkAvailability?.();
    expect(observed).toEqual([
      { url: 'https://rmc.bytedance.com/verifycenter/captcha/v2', blocked: false },
      { url: 'https://rmc.bytedance.com.evil.example/verifycenter/captcha/v2', blocked: true },
      { url: 'http://rmc.bytedance.com/verifycenter/captcha/v2', blocked: true },
      { url: 'bytedance://launch', blocked: true },
    ]);
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
