/* Implements isolated persistent browser profiles and fixed document snapshots for Discovery Sources. */
import { BrowserWindow, session, type BrowserWindowConstructorOptions } from 'electron';
import { getAppIconPath } from '../../app/app-icon';
import type {
  EmbeddedBrowser,
  EmbeddedBrowserProfileId,
  EmbeddedBrowserSnapshot,
  EmbeddedBrowserSnapshotResult,
} from '@megumi/application/recommendation/sources/browser-access';
import { PLATFORM_PAGE_READER, PLATFORM_ORIGINS } from '@megumi/application/recommendation/sources/platform-page-reader';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SETTLE_DELAY_MS = 1_500;
const SNAPSHOT_SCRIPT = `(() => {
  const clean = (value, max) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, max);
  const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 300).map((anchor) => {
    // Prefer the complete semantic card over an inner footer that may contain only an avatar.
    const container = anchor.closest('article, li, section, [role="listitem"]') || anchor.closest('div');
    const image = anchor.querySelector('img') || container?.querySelector('img');
    return {
      href: anchor.href,
      text: clean(anchor.innerText || anchor.textContent, 500),
      contextText: clean(container?.innerText || anchor.innerText || anchor.textContent, 2000),
      imageUrl: image?.currentSrc || image?.src || undefined,
    };
  });
  const cards = [];
  // Douyin's rendered cards carry content data in React, not in anchor elements.
  // Read only whitelisted public content fields, never serialize component state.
  if (location.hostname === 'www.douyin.com') {
    for (const card of Array.from(document.querySelectorAll('.search-result-card')).slice(0, 300)) {
      const id = card.closest('[id^="waterfall_item_"]')?.id.replace('waterfall_item_', '');
      if (!id || !/^\\d+$/.test(id)) continue;
      const fiberKey = Object.keys(card).find((key) => key.startsWith('__reactFiber$'));
      let fiber = fiberKey ? card[fiberKey] : undefined;
      for (let depth = 0; fiber && depth < 12; depth++, fiber = fiber.return) {
        const content = fiber.memoizedProps?.data?.awemeInfo;
        if (content?.awemeId !== id || typeof content.desc !== 'string' || !content.desc.trim()) continue;
        const image = card.querySelector('img');
        cards.push({
          id, title: clean(content.desc, 500),
          contextText: clean(card.innerText || card.textContent, 2000),
          imageUrl: image?.currentSrc || image?.src || undefined,
        });
        break;
      }
    }
  }
  return {
    finalUrl: location.href,
    title: clean(document.title, 500) || undefined,
    bodyText: clean(document.body?.innerText, 20000),
    links,
    ...(cards.length ? { cards } : {}),
  };
})()`;

type WindowFactory = (options: BrowserWindowConstructorOptions) => BrowserWindow;

export function createElectronEmbeddedBrowser(input: {
  readonly createWindow?: WindowFactory;
  readonly timeoutMs?: number;
  readonly settleDelayMs?: number;
} = {}): EmbeddedBrowser {
  const createWindow = input.createWindow ?? ((options) => new BrowserWindow(options));
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const settleDelayMs = input.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS;
  const loginWindows = new Map<EmbeddedBrowserProfileId, {
    readonly window: BrowserWindow;
    readonly closed: Promise<void>;
  }>();
  const taskWindows = new Set<BrowserWindow>();
  const queues = new Map<EmbeddedBrowserProfileId, Promise<void>>();
  const slotWaiters = new Set<() => void>();
  const activeCancels = new Set<() => void>();
  let activeSlots = 0;
  let shuttingDown = false;

  return {
    readPlatform(request) {
      return enqueue<EmbeddedBrowserSnapshotResult>(request.profileId, async () => {
        if (request.signal.aborted || shuttingDown) return failed('cancelled', 'Platform read was cancelled.');
        const origins = PLATFORM_ORIGINS[request.profileId];
        try { requireAllowedUrl(request.url, origins); } catch { return failed('invalid_response', 'Platform URL is outside the allowed origins.'); }
        const releaseSlot = await takeSlot(request.signal);
        if (!releaseSlot) return failed('cancelled', 'Platform read was cancelled.');
        let window: BrowserWindow;
        try { window = createWindow(embeddedBrowserWindowOptions(request.profileId, false)); } catch { releaseSlot(); return failed('network_error', 'Platform task window could not be created.'); }
        taskWindows.add(window);
        const responses: { url: string; status: number; body: string }[] = [];
        const responseIds = new Map<string, { url: string; status: number }>();
        const reads = new Set<Promise<void>>();
        const debuggerPort = window.webContents.debugger;
        const observe = request.profileId === 'xiaohongshu' && request.operation === 'search';
        let attached = false;
        let tooLarge = false;
        let responseBytes = 0;
        let timedOut = false;
        let rejectStopped: (error: Error) => void = () => undefined;
        const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
        void stopped.catch(() => undefined);
        const stop = () => { rejectStopped(new Error('Platform read stopped.')); window.webContents.stop(); if (!window.isDestroyed()) window.destroy(); };
        activeCancels.add(stop);
        const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
        request.signal.addEventListener('abort', stop, { once: true });
        const onMessage = (_event: unknown, method: string, params: Record<string, unknown>) => {
          if (method === 'Network.responseReceived') {
            const response = params.response;
            if (!isRecord(response) || typeof response.url !== 'string' || typeof response.status !== 'number' || typeof params.requestId !== 'string') return;
            let url: URL;
            try { url = new URL(response.url); } catch { return; }
            if (['https://www.xiaohongshu.com', 'https://edith.xiaohongshu.com'].includes(url.origin) && url.pathname === '/api/sns/web/v2/search/notes') responseIds.set(params.requestId, { url: response.url, status: response.status });
          }
          if (method !== 'Network.loadingFinished' || typeof params.requestId !== 'string') return;
          const response = responseIds.get(params.requestId);
          if (!response) return;
          responseIds.delete(params.requestId);
          if (typeof params.encodedDataLength === 'number' && params.encodedDataLength > 2 * 1024 * 1024) { tooLarge = true; return; }
          const read = debuggerPort.sendCommand('Network.getResponseBody', { requestId: params.requestId }).then((value: { body: string; base64Encoded?: boolean }) => {
            const body = value.base64Encoded ? Buffer.from(value.body, 'base64').toString('utf8') : value.body;
            if ((responseBytes += Buffer.byteLength(body)) > 2 * 1024 * 1024) { tooLarge = true; return; }
            responses.push({ ...response, body });
          }).catch(() => undefined);
          reads.add(read);
          void read.finally(() => reads.delete(read));
        };
        try {
          window.webContents.setAudioMuted(true);
          secureWindow(window, origins);
          if (observe) {
            debuggerPort.attach('1.3'); attached = true;
            debuggerPort.on('message', onMessage);
            await debuggerPort.sendCommand('Network.enable');
          }
          await Promise.race([window.loadURL(request.url), stopped]);
          while (true) {
            if (request.signal.aborted || shuttingDown) return failed('cancelled', 'Platform read was cancelled.');
            if (timedOut) return failed('timeout', 'Platform read timed out.');
            await Promise.race([Promise.allSettled(reads), stopped]);
            if (tooLarge) return failed('material_too_large', 'Platform response exceeded 2 MiB.');
            const snapshot = normalizeSnapshot(await Promise.race([window.webContents.executeJavaScript(PLATFORM_PAGE_READER, false), stopped]), 50_000);
            requireAllowedUrl(snapshot.finalUrl, origins);
            if (responses.length || snapshot.completed || snapshot.pageState === 'login_required' || snapshot.pageState === 'challenge_required' || request.operation === 'status' || snapshot.structuredData || snapshot.bodyText || snapshot.links.some((link) => /\/(explore|discovery\/item|search_result|video|question|p)\//.test(link.href))) {
              return { status: 'success', snapshot: { ...snapshot, ...(responses.length ? { responses } : {}) } };
            }
            await delay(100, request.signal);
          }
        } catch (error) {
          if (error instanceof SnapshotTooLarge) return failed('material_too_large', 'Platform material exceeded 2 MiB.');
          return failed(request.signal.aborted || shuttingDown ? 'cancelled' : timedOut ? 'timeout' : 'network_error', 'Platform read could not complete.');
        } finally {
          clearTimeout(timer);
          request.signal.removeEventListener('abort', stop);
          if (attached) { debuggerPort.removeListener('message', onMessage); try { debuggerPort.detach(); } catch {} }
          if (!window.isDestroyed()) window.destroy();
          taskWindows.delete(window);
          activeCancels.delete(stop);
          releaseSlot();
        }
      }, request.signal).catch((error: unknown) => {
        if (request.signal.aborted || shuttingDown) return failed('cancelled', 'Platform read was cancelled.');
        throw error;
      });
    },
    fetchWithSession(request) {
      const url = new URL(request.url);
      const apiPaths = new Set(['/x/web-interface/nav', '/x/web-interface/wbi/search/type', '/x/web-interface/view', '/x/web-interface/wbi/view', '/x/player/v2', '/x/player/wbi/v2']);
      const subtitle = (url.hostname === 'aisubtitle.hdslb.com' || url.hostname.endsWith('.hdslb.com')) && url.pathname.startsWith('/bfs/subtitle/');
      if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'api.bilibili.com' && apiPaths.has(url.pathname) || subtitle)) return Promise.reject(new Error('Session URL is not an approved platform read endpoint.'));
      return enqueue('bilibili', async () => {
        if (request.signal?.aborted || shuttingDown) throw new Error('Platform request was cancelled.');
        return session.fromPartition('persist:megumi-discovery-bilibili').fetch(url.toString(), { method: 'GET', credentials: 'include', redirect: 'error', headers: { Referer: 'https://www.bilibili.com/' }, signal: request.signal });
      });
    },
    async openLogin(request) {
      requireAllowedUrl(request.url, request.allowedOrigins);
      if (shuttingDown) throw new Error('Embedded browser is shutting down.');
      const current = loginWindows.get(request.profileId);
      if (current && !current.window.isDestroyed()) {
        void current.window.loadURL(request.url).catch(() => { if (!current.window.isDestroyed()) current.window.destroy(); });
        current.window.show();
        current.window.focus();
        return { closed: current.closed };
      }
      const window = createWindow(embeddedBrowserWindowOptions(request.profileId, true));
      const closed = new Promise<void>((resolve) => {
        window.once('closed', () => {
          loginWindows.delete(request.profileId);
          resolve();
        });
      });
      loginWindows.set(request.profileId, { window, closed });
      secureWindow(window, request.allowedOrigins);
      window.show();
      void window.loadURL(request.url).catch(() => { if (!window.isDestroyed()) window.destroy(); });
      return { closed };
    },
    snapshot(request) {
      return enqueue(request.profileId, async () => {
        if (request.signal.aborted) return failed('cancelled', 'Embedded browser task was cancelled.');
        if (shuttingDown) return failed('cancelled', 'Embedded browser is shutting down.');
        try { requireAllowedUrl(request.url, request.allowedOrigins); } catch {
          return failed('invalid_response', 'Embedded browser URL is outside the allowed origins.');
        }
        const window = createWindow(embeddedBrowserWindowOptions(request.profileId, false));
        // Background Source snapshots must never emit page audio; interactive login windows remain unaffected.
        window.webContents.setAudioMuted(true);
        taskWindows.add(window);
        secureWindow(window, request.allowedOrigins);
        let timedOut = false;
        const abort = () => {
          window.webContents.stop();
          if (!window.isDestroyed()) window.destroy();
        };
        request.signal.addEventListener('abort', abort, { once: true });
        const timeout = setTimeout(() => {
          timedOut = true;
          abort();
        }, timeoutMs);
        try {
          await window.loadURL(request.url);
          if (settleDelayMs > 0) await delay(settleDelayMs, request.signal);
          if (request.signal.aborted) return failed('cancelled', 'Embedded browser task was cancelled.');
          if (timedOut) return failed('timeout', 'Embedded browser task timed out.');
          const snapshot = normalizeSnapshot(await window.webContents.executeJavaScript(SNAPSHOT_SCRIPT, true));
          return { status: 'success', snapshot };
        } catch (error) {
          if (request.signal.aborted) return failed('cancelled', 'Embedded browser task was cancelled.');
          if (timedOut) return failed('timeout', 'Embedded browser task timed out.');
          return failed('network_error', error instanceof Error ? error.message : 'Embedded browser task failed.');
        } finally {
          clearTimeout(timeout);
          request.signal.removeEventListener('abort', abort);
          taskWindows.delete(window);
          if (!window.isDestroyed()) window.destroy();
        }
      });
    },
    async shutdown() {
      shuttingDown = true;
      for (const cancel of activeCancels) cancel();
      for (const wake of slotWaiters) wake();
      for (const window of [...taskWindows, ...[...loginWindows.values()].map((entry) => entry.window)]) {
        if (!window.isDestroyed()) window.destroy();
      }
      taskWindows.clear();
      loginWindows.clear();
      await Promise.allSettled(queues.values());
    },
  };

  async function takeSlot(signal: AbortSignal): Promise<(() => void) | undefined> {
    while (activeSlots >= 2 && !signal.aborted && !shuttingDown) {
      await new Promise<void>((resolve) => {
        const wake = () => { slotWaiters.delete(wake); signal.removeEventListener('abort', wake); resolve(); };
        slotWaiters.add(wake);
        signal.addEventListener('abort', wake, { once: true });
      });
    }
    if (signal.aborted || shuttingDown) return undefined;
    activeSlots += 1;
    return () => { activeSlots -= 1; slotWaiters.values().next().value?.(); };
  }

  function enqueue<T>(profileId: EmbeddedBrowserProfileId, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const previous = queues.get(profileId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(() => undefined, () => undefined);
    queues.set(profileId, tail);
    void tail.finally(() => {
      if (queues.get(profileId) === tail) queues.delete(profileId);
    });
    if (!signal) return result;
    if (signal.aborted) { void result.catch(() => undefined); return Promise.reject(signal.reason); }
    let abort: () => void = () => undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
    });
    return Promise.race([result, cancelled]).finally(() => signal.removeEventListener('abort', abort));
  }
}

export function embeddedBrowserWindowOptions(
  profileId: EmbeddedBrowserProfileId,
  visible: boolean,
): BrowserWindowConstructorOptions {
  return {
    width: 1180,
    icon: getAppIconPath(),
    height: 820,
    show: visible,
    backgroundColor: '#111827',
    webPreferences: {
      partition: `persist:megumi-discovery-${profileId}`,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  };
}

function secureWindow(window: BrowserWindow, allowedOrigins: readonly string[]): void {
  const allowed = new Set(allowedOrigins.map(normalizeOrigin));
  const preventDisallowedNavigation = (event: { preventDefault(): void }, url: string) => {
    if (!isAllowedUrl(url, allowed)) event.preventDefault();
  };
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', preventDisallowedNavigation);
  // Source pages can request custom app protocols from nested frames without a top-level navigation.
  window.webContents.on('will-frame-navigate', (event) => {
    preventDisallowedNavigation(event, event.url);
  });
}

function requireAllowedUrl(value: string, origins: readonly string[]): void {
  if (!isAllowedUrl(value, new Set(origins.map(normalizeOrigin)))) {
    throw new Error('Embedded browser URL is outside the allowed origins.');
  }
}

function isAllowedUrl(value: string, origins: ReadonlySet<string>): boolean {
  try { return origins.has(new URL(value).origin); } catch { return false; }
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('Embedded browser origins must use HTTPS.');
  return url.origin;
}

class SnapshotTooLarge extends Error {}

function normalizeSnapshot(value: unknown, maxTextPoints = 20_000): EmbeddedBrowserSnapshot {
  if (!isRecord(value) || typeof value.finalUrl !== 'string' || typeof value.bodyText !== 'string' || !Array.isArray(value.links)) {
    throw new Error('Embedded browser returned an invalid document snapshot.');
  }
  if (maxTextPoints === 50_000 && Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024) throw new SnapshotTooLarge();
  const finalUrl = new URL(value.finalUrl).toString();
  return {
    finalUrl,
    ...(value.structuredData !== undefined ? { structuredData: value.structuredData } : {}),
    ...(typeof value.completed === 'boolean' ? { completed: value.completed } : {}),
    ...(value.pageState === 'available' || value.pageState === 'login_required' || value.pageState === 'challenge_required' ? { pageState: value.pageState } : {}),
    ...(typeof value.title === 'string' && value.title.trim() ? { title: value.title.trim() } : {}),
    bodyText: [...value.bodyText].slice(0, maxTextPoints).join(''),
    ...(maxTextPoints === 50_000 ? { truncated: value.truncated === true || [...value.bodyText].length > maxTextPoints } : {}),
    ...(Array.isArray(value.cards) ? { cards: value.cards.slice(0, 300).flatMap((card) => {
      if (!isRecord(card) || typeof card.id !== 'string' || typeof card.title !== 'string') return [];
      if (!card.id.trim() || !card.title.trim()) return [];
      return [{
        id: card.id.slice(0, 200), title: card.title.slice(0, 500),
        ...(typeof card.contextText === 'string' ? { contextText: card.contextText.slice(0, 2_000) } : {}),
        ...(typeof card.imageUrl === 'string' ? { imageUrl: card.imageUrl } : {}),
      }];
    }) } : {}),
    links: value.links.slice(0, 300).flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.href !== 'string' || typeof entry.text !== 'string') return [];
      try {
        return [{
          href: new URL(entry.href, finalUrl).toString(),
          text: entry.text.slice(0, 500),
          ...(typeof entry.contextText === 'string' && entry.contextText.trim() ? { contextText: entry.contextText.slice(0, 2_000) } : {}),
          ...(typeof entry.imageUrl === 'string' && entry.imageUrl.trim() ? { imageUrl: entry.imageUrl } : {}),
        }];
      } catch { return []; }
    }),
  };
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timeout);
      reject(signal.reason ?? new Error('Cancelled'));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}

function failed(code: 'timeout' | 'network_error' | 'invalid_response' | 'material_too_large' | 'cancelled', message: string): EmbeddedBrowserSnapshotResult {
  return { status: 'failed', failure: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
