/* Implements the authenticated localhost transport for the Chromium extension. */
import crypto from 'node:crypto';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import {
  BrowserSourceIdSchema,
  BrowserSourceTaskResultSchema,
  type BrowserSourceTaskGateway,
  type BrowserSourceTaskRequest,
  type BrowserSourceTaskResult,
} from '@megumi/discovery';
import { createBrowserSourceTaskManager } from './browser-source-task-manager';

const PAIRING_TTL_MS = 5 * 60_000;
const HEARTBEAT_TTL_MS = 60_000;

export interface BrowserSourceConnectionRecord {
  readonly port: number;
  readonly tokenHash?: string;
}

export interface BrowserSourceConnectionStore {
  read(): BrowserSourceConnectionRecord | undefined;
  write(record: BrowserSourceConnectionRecord): void;
}

export type BrowserSourceConnectionView = {
  readonly state: 'ready' | 'extension_offline' | 'not_configured';
  readonly port?: number;
  readonly checkedAt?: string;
};

export interface BrowserSourceLoopbackServer extends BrowserSourceTaskGateway {
  start(): Promise<{ readonly status: 'listening'; readonly port: number } | { readonly status: 'not_configured' }>;
  stop(): Promise<void>;
  getConnection(): BrowserSourceConnectionView;
  beginPairing(): { readonly code: string; readonly expiresAt: string; readonly port: number };
  revokeConnection(): BrowserSourceConnectionView;
}

export function createBrowserSourceLoopbackServer(input: {
  readonly store: BrowserSourceConnectionStore;
  readonly now?: () => number;
  readonly createSecret?: () => string;
}): BrowserSourceLoopbackServer {
  const now = input.now ?? Date.now;
  const createSecret = input.createSecret ?? (() => crypto.randomUUID());
  let persisted = input.store.read();
  let listeningPort: number | undefined;
  let server: http.Server | undefined;
  let pairing: { code: string; expiresAt: number } | undefined;
  let lastHeartbeatAt: number | undefined;
  let configured = true;
  const sockets = new WebSocketServer({ noServer: true });
  const manager = createBrowserSourceTaskManager({
    createId: createSecret,
    getConnectionState: () => connectionState(),
  });
  const unsubscribe = manager.subscribeTaskAvailable((sourceId) => {
    const payload = JSON.stringify({ type: 'task_available', sourceId });
    for (const socket of sockets.clients) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  });

  const connectionState = (): BrowserSourceConnectionView => {
    if (!configured || listeningPort === undefined) return { state: 'not_configured' };
    if (!persisted?.tokenHash || !lastHeartbeatAt || now() - lastHeartbeatAt > HEARTBEAT_TTL_MS) {
      return { state: 'extension_offline', port: listeningPort };
    }
    return { state: 'ready', port: listeningPort, checkedAt: new Date(lastHeartbeatAt).toISOString() };
  };

  const api: BrowserSourceLoopbackServer = {
    getConnectionState: () => {
      const state = connectionState();
      return { state: state.state, ...(state.checkedAt ? { checkedAt: state.checkedAt } : {}) };
    },
    async execute(request: BrowserSourceTaskRequest, options): Promise<BrowserSourceTaskResult> {
      if (connectionState().state !== 'ready') {
        return { status: 'failed', failure: { code: 'extension_offline', message: 'Megumi browser extension is offline.' } };
      }
      return manager.execute(request, options);
    },
    async start() {
      if (server && listeningPort !== undefined) return { status: 'listening', port: listeningPort };
      const nextServer = http.createServer((request, response) => {
        void handleHttp(request, response);
      });
      nextServer.on('upgrade', (request, socket, head) => {
        const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (requestUrl.pathname !== '/events' || !authenticate(requestUrl.searchParams.get('token'))) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        lastHeartbeatAt = now();
        sockets.handleUpgrade(request, socket, head, (webSocket) => sockets.emit('connection', webSocket, request));
      });
      try {
        await listen(nextServer, persisted?.port ?? 0);
        const address = nextServer.address();
        if (!address || typeof address === 'string') throw new Error('Loopback server address was unavailable.');
        server = nextServer;
        listeningPort = address.port;
        configured = true;
        persisted = { port: listeningPort, ...(persisted?.tokenHash ? { tokenHash: persisted.tokenHash } : {}) };
        input.store.write(persisted);
        return { status: 'listening', port: listeningPort };
      } catch {
        configured = false;
        nextServer.close();
        return { status: 'not_configured' };
      }
    },
    async stop() {
      pairing = undefined;
      manager.cancelAll();
      unsubscribe();
      for (const socket of sockets.clients) socket.close(1001, 'Megumi is shutting down.');
      const current = server;
      server = undefined;
      listeningPort = undefined;
      if (current) await new Promise<void>((resolve) => current.close(() => resolve()));
    },
    getConnection: () => connectionState(),
    beginPairing() {
      if (listeningPort === undefined) throw new Error('Browser source transport is not listening.');
      pairing = { code: createSecret(), expiresAt: now() + PAIRING_TTL_MS };
      return { code: pairing.code, expiresAt: new Date(pairing.expiresAt).toISOString(), port: listeningPort };
    },
    revokeConnection() {
      pairing = undefined;
      lastHeartbeatAt = undefined;
      persisted = { port: listeningPort ?? persisted?.port ?? 0 };
      input.store.write(persisted);
      for (const socket of sockets.clients) socket.close(4001, 'Pairing revoked.');
      manager.cancelAll();
      return connectionState();
    },
  };
  return api;

  async function handleHttp(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'POST' && requestUrl.pathname === '/pair') {
      const body = await readJson(request);
      const code = isRecord(body) && typeof body.code === 'string' ? body.code : '';
      if (!pairing || pairing.code !== code || pairing.expiresAt < now()) return send(response, 401, { code: 'pairing_invalid' });
      pairing = undefined;
      const token = createSecret();
      persisted = { port: listeningPort!, tokenHash: hash(token) };
      input.store.write(persisted);
      lastHeartbeatAt = now();
      return send(response, 200, { token, port: listeningPort });
    }
    if (!authenticate(bearerToken(request))) return send(response, 401, { code: 'unauthorized' });
    lastHeartbeatAt = now();
    if (request.method === 'POST' && requestUrl.pathname === '/heartbeat') {
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/tasks/claim') {
      const parsed = BrowserSourceIdSchema.safeParse(requestUrl.searchParams.get('sourceId'));
      if (!parsed.success) return send(response, 400, { code: 'source_invalid' });
      return send(response, 200, manager.claim(parsed.data) ?? { status: 'empty' });
    }
    const resultMatch = request.method === 'POST' ? requestUrl.pathname.match(/^\/tasks\/([^/]+)\/result$/u) : undefined;
    if (resultMatch) {
      const body = await readJson(request);
      if (!isRecord(body) || typeof body.claimToken !== 'string') return send(response, 400, { code: 'result_invalid' });
      const parsed = BrowserSourceTaskResultSchema.safeParse(body.result);
      if (!parsed.success) return send(response, 400, { code: 'result_invalid' });
      try {
        manager.complete(decodeURIComponent(resultMatch[1]), body.claimToken, parsed.data);
        return send(response, 204);
      } catch (error) {
        return send(response, 409, { code: 'task_rejected', message: error instanceof Error ? error.message : 'Task rejected.' });
      }
    }
    return send(response, 404, { code: 'not_found' });
  }

  function authenticate(token: string | null | undefined): boolean {
    if (!token || !persisted?.tokenHash) return false;
    const actual = Buffer.from(hash(token));
    const expected = Buffer.from(persisted.tokenHash);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
}

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

async function readJson(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 256 * 1024) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return undefined; }
}

function send(response: http.ServerResponse, status: number, value?: unknown): void {
  response.statusCode = status;
  if (value === undefined) { response.end(); return; }
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
}

function bearerToken(request: http.IncomingMessage): string | undefined {
  const value = request.headers.authorization;
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : undefined;
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
