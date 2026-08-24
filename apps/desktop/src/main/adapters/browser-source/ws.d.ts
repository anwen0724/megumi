/* Minimal runtime declarations for the server-only subset of ws used by Desktop. */
declare module 'ws' {
  import type http from 'node:http';
  import type { Duplex } from 'node:stream';

  export class WebSocket {
    static readonly OPEN: number;
    readonly OPEN: number;
    readonly readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
  }

  export class WebSocketServer {
    constructor(options: { noServer: true });
    readonly clients: Set<WebSocket>;
    handleUpgrade(
      request: http.IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (socket: WebSocket) => void,
    ): void;
    emit(event: 'connection', socket: WebSocket, request: http.IncomingMessage): boolean;
  }
}
