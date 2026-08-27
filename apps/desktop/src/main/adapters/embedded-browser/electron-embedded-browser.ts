/* Implements isolated persistent browser profiles and fixed document snapshots for Discovery Sources. */
import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import type {
  EmbeddedBrowser,
  EmbeddedBrowserProfileId,
  EmbeddedBrowserSnapshot,
  EmbeddedBrowserSnapshotResult,
} from '@megumi/discovery';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SETTLE_DELAY_MS = 1_500;
const SNAPSHOT_SCRIPT = `(() => {
  const clean = (value, max) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, max);
  const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 300).map((anchor) => {
    const container = anchor.closest('article, li, section, [role="listitem"], div');
    const image = anchor.querySelector('img') || container?.querySelector('img');
    return {
      href: anchor.href,
      text: clean(anchor.innerText || anchor.textContent, 500),
      contextText: clean(container?.innerText || anchor.innerText || anchor.textContent, 2000),
      imageUrl: image?.currentSrc || image?.src || undefined,
    };
  });
  return {
    finalUrl: location.href,
    title: clean(document.title, 500) || undefined,
    bodyText: clean(document.body?.innerText, 20000),
    links,
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
  let shuttingDown = false;

  return {
    async openLogin(request) {
      requireAllowedUrl(request.url, request.allowedOrigins);
      if (shuttingDown) throw new Error('Embedded browser is shutting down.');
      const current = loginWindows.get(request.profileId);
      if (current && !current.window.isDestroyed()) {
        await current.window.loadURL(request.url);
        current.window.show();
        current.window.focus();
        return current.closed;
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
      try {
        await window.loadURL(request.url);
        window.show();
        await closed;
      } catch (error) {
        loginWindows.delete(request.profileId);
        if (!window.isDestroyed()) window.destroy();
        throw error;
      }
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
      for (const window of [...taskWindows, ...[...loginWindows.values()].map((entry) => entry.window)]) {
        if (!window.isDestroyed()) window.destroy();
      }
      taskWindows.clear();
      loginWindows.clear();
      await Promise.allSettled(queues.values());
    },
  };

  function enqueue<T>(profileId: EmbeddedBrowserProfileId, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(profileId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(() => undefined, () => undefined);
    queues.set(profileId, tail);
    void tail.finally(() => {
      if (queues.get(profileId) === tail) queues.delete(profileId);
    });
    return result;
  }
}

export function embeddedBrowserWindowOptions(
  profileId: EmbeddedBrowserProfileId,
  visible: boolean,
): BrowserWindowConstructorOptions {
  return {
    width: 1180,
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

function normalizeSnapshot(value: unknown): EmbeddedBrowserSnapshot {
  if (!isRecord(value) || typeof value.finalUrl !== 'string' || typeof value.bodyText !== 'string' || !Array.isArray(value.links)) {
    throw new Error('Embedded browser returned an invalid document snapshot.');
  }
  const finalUrl = new URL(value.finalUrl).toString();
  return {
    finalUrl,
    ...(typeof value.title === 'string' && value.title.trim() ? { title: value.title.trim() } : {}),
    bodyText: value.bodyText.slice(0, 20_000),
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

function failed(code: 'timeout' | 'network_error' | 'invalid_response' | 'cancelled', message: string): EmbeddedBrowserSnapshotResult {
  return { status: 'failed', failure: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
