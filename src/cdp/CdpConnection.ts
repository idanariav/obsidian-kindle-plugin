import { NodeWebSocket } from './NodeWebSocket';

/**
 * Minimal Chrome DevTools Protocol client: a thin JSON-RPC-over-
 * WebSocket layer, just enough for the Target/Page/Network domains
 * CdpBrowser.ts needs. Deliberately hand-rolled rather than depending
 * on a library like chrome-remote-interface, puppeteer-core, or
 * playwright-core - those bundle their own runtime file-path
 * assumptions (e.g. reading their own package.json via a
 * `__dirname`-relative path) that don't survive esbuild/webpack
 * bundling into the single `main.js` Obsidian Community Plugins
 * require.
 *
 * Ported (MIT license) from x5gtrn/kindle-bridge.
 *
 * Connects via NodeWebSocket (see that file), not the browser
 * `WebSocket` global - Obsidian's renderer process CSP blocks the DOM
 * WebSocket from reaching the local Chrome DevTools port.
 */

/** The minimal subset of the WebSocket surface this file depends on -
 * satisfied by NodeWebSocket. */
export interface WebSocketLike {
  addEventListener(
    type: string,
    listener: (event: unknown) => void,
    options?: { once?: boolean }
  ): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  send(data: string): void;
  close(): void;
}

interface PendingRequest {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

interface CdpErrorPayload {
  code: number;
  message: string;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: CdpErrorPayload;
  sessionId?: string;
}

export class CdpProtocolError extends Error {
  constructor(method: string, cause: CdpErrorPayload) {
    super(`CDP command "${method}" failed: ${cause.message} (code ${cause.code})`);
    this.name = 'CdpProtocolError';
  }
}

export class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly eventListeners = new Map<string, Set<(params: unknown) => void>>();

  private constructor(private readonly socket: WebSocketLike) {
    this.socket.addEventListener('message', (event: unknown) => {
      this.handleMessage(String((event as { data?: unknown }).data));
    });
  }

  static connect(webSocketUrl: string): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const socket = new NodeWebSocket(webSocketUrl);
      const onOpen = () => {
        socket.removeEventListener('error', onError);
        resolve(new CdpConnection(socket));
      };
      const onError = () => {
        socket.removeEventListener('open', onOpen);
        reject(new Error(`Could not connect to ${webSocketUrl}`));
      };
      socket.addEventListener('open', onOpen, { once: true });
      socket.addEventListener('error', onError, { once: true });
    });
  }

  send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string
  ): Promise<T> {
    const id = this.nextId++;
    const message: CdpMessage = { id, method, params };
    if (sessionId) {
      message.sessionId = sessionId;
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        method,
        resolve: resolve as (result: unknown) => void,
        reject,
      });
      this.socket.send(JSON.stringify(message));
    });
  }

  on(event: string, listener: (params: unknown) => void): void {
    const listeners = this.eventListeners.get(event) ?? new Set();
    listeners.add(listener);
    this.eventListeners.set(event, listeners);
  }

  off(event: string, listener: (params: unknown) => void): void {
    this.eventListeners.get(event)?.delete(listener);
  }

  close(): void {
    this.socket.close();
  }

  private handleMessage(raw: string): void {
    let message: CdpMessage;
    try {
      message = JSON.parse(raw) as CdpMessage;
    } catch {
      return;
    }

    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new CdpProtocolError(pending.method, message.error));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.method === 'string') {
      const listeners = this.eventListeners.get(message.method);
      listeners?.forEach((listener) => listener(message.params));
    }
  }
}
