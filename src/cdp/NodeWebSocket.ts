import { createHash, randomBytes } from 'crypto';
import { connect as netConnect, Socket } from 'net';

/**
 * Minimal RFC 6455 WebSocket client built directly on Node's `net`
 * module, used instead of the browser `WebSocket` global.
 *
 * Obsidian's plugin code runs in an Electron renderer process, which
 * enforces a Content-Security-Policy that blocks the DOM `WebSocket`
 * implementation from connecting to arbitrary `ws://` origins - the
 * same reason Obsidian's own API provides `requestUrl()` instead of
 * `fetch()` for plugins that need to make CORS-restricted requests.
 * The DOM `WebSocket` reliably fails to connect to the local Chrome
 * DevTools port even though the browser itself is up and the port is
 * open. A raw `net.Socket` is not subject to that policy, so
 * hand-rolling just enough of the WebSocket handshake and frame
 * format to carry CDP's JSON-RPC messages avoids the restriction
 * entirely.
 *
 * Ported (MIT license) from x5gtrn/kindle-bridge, which hit and solved
 * this exact problem for the same reason this plugin needs it.
 *
 * This only implements what CdpConnection.ts needs: opening handshake,
 * text-frame send/receive, close frames, and responding to pings - not
 * a general-purpose WebSocket client (no compression extensions, no
 * fragmented-message reassembly, since Chrome's CDP server sends each
 * JSON-RPC message as a single unfragmented text frame).
 */

const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OPCODE_TEXT = 0x1;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

type Listener = (event: unknown) => void;

export class NodeWebSocket {
  private readonly socket: Socket;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly onceListeners = new WeakMap<Listener, string>();
  private handshakeResponseBuffer = Buffer.alloc(0);
  private handshakeComplete = false;
  private frameBuffer = Buffer.alloc(0);
  private readonly expectedAccept: string;

  constructor(url: string) {
    const parsed = new URL(url);
    const port = Number(parsed.port) || 80;
    const secWebSocketKey = randomBytes(16).toString('base64');
    this.expectedAccept = createHash('sha1')
      .update(secWebSocketKey + WEBSOCKET_GUID)
      .digest('base64');

    this.socket = netConnect({ host: parsed.hostname, port }, () => {
      const path = `${parsed.pathname}${parsed.search}`;
      const request =
        `GET ${path} HTTP/1.1\r\n` +
        `Host: ${parsed.hostname}:${port}\r\n` +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${secWebSocketKey}\r\n` +
        'Sec-WebSocket-Version: 13\r\n' +
        '\r\n';
      this.socket.write(request);
    });

    this.socket.on('data', (chunk: Buffer) => {
      if (this.handshakeComplete) {
        this.onFrameData(chunk);
      } else {
        this.onHandshakeData(chunk);
      }
    });
    this.socket.on('error', (error) => this.emit('error', error));
    this.socket.on('close', () => this.emit('close', undefined));
  }

  addEventListener(type: string, listener: Listener, options?: { once?: boolean }): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
    if (options?.once) {
      this.onceListeners.set(listener, type);
    }
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    this.writeFrame(OPCODE_TEXT, Buffer.from(data, 'utf8'));
  }

  close(): void {
    try {
      this.writeFrame(OPCODE_CLOSE, Buffer.alloc(0));
    } catch {
      // Socket may already be closed/unwritable - nothing more to do.
    }
    this.socket.end();
  }

  private emit(type: string, event: unknown): void {
    const set = this.listeners.get(type);
    if (!set) {
      return;
    }
    for (const listener of [...set]) {
      listener(event);
      if (this.onceListeners.get(listener) === type) {
        set.delete(listener);
        this.onceListeners.delete(listener);
      }
    }
  }

  private onHandshakeData(chunk: Buffer): void {
    this.handshakeResponseBuffer = Buffer.concat([this.handshakeResponseBuffer, chunk]);
    const headerEnd = this.handshakeResponseBuffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      return;
    }

    const header = this.handshakeResponseBuffer.subarray(0, headerEnd).toString('latin1');
    const remainder = this.handshakeResponseBuffer.subarray(headerEnd + 4);
    const statusLine = header.split('\r\n')[0] ?? '';
    const acceptMatch = /sec-websocket-accept:\s*(\S+)/i.exec(header);

    if (!statusLine.includes(' 101 ') || acceptMatch?.[1] !== this.expectedAccept) {
      this.emit('error', new Error(`WebSocket handshake failed: ${statusLine || 'no response'}`));
      this.socket.destroy();
      return;
    }

    this.handshakeComplete = true;
    this.emit('open', undefined);
    if (remainder.length > 0) {
      this.onFrameData(remainder);
    }
  }

  private onFrameData(chunk: Buffer): void {
    this.frameBuffer = Buffer.concat([this.frameBuffer, chunk]);

    // A single TCP chunk can contain multiple frames (or a partial
    // one), so keep parsing complete frames off the front of the
    // buffer until what's left isn't enough to decode.
    let frame = readFrame(this.frameBuffer);
    while (frame) {
      this.frameBuffer = this.frameBuffer.subarray(frame.bytesConsumed);
      this.handleFrame(frame.opcode, frame.payload);
      frame = readFrame(this.frameBuffer);
    }
  }

  private handleFrame(opcode: number, payload: Buffer): void {
    switch (opcode) {
      case OPCODE_TEXT:
        this.emit('message', { data: payload.toString('utf8') });
        return;
      case OPCODE_PING:
        this.writeFrame(OPCODE_PONG, payload);
        return;
      case OPCODE_CLOSE:
        this.socket.end();
        return;
      default:
        return;
    }
  }

  private writeFrame(opcode: number, payload: Buffer): void {
    const mask = randomBytes(4);
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) {
      masked.writeUInt8(payload.readUInt8(i) ^ mask.readUInt8(i % 4), i);
    }

    const header = buildFrameHeader(opcode, payload.length, mask);
    this.socket.write(Buffer.concat([header, masked]));
  }
}

function buildFrameHeader(opcode: number, payloadLength: number, mask: Buffer): Buffer {
  const finAndOpcode = 0x80 | opcode;
  const maskBit = 0x80;

  if (payloadLength < 126) {
    return Buffer.concat([Buffer.from([finAndOpcode, maskBit | payloadLength]), mask]);
  }
  if (payloadLength < 65536) {
    const header = Buffer.alloc(4);
    header[0] = finAndOpcode;
    header[1] = maskBit | 126;
    header.writeUInt16BE(payloadLength, 2);
    return Buffer.concat([header, mask]);
  }
  const header = Buffer.alloc(10);
  header[0] = finAndOpcode;
  header[1] = maskBit | 127;
  header.writeBigUInt64BE(BigInt(payloadLength), 2);
  return Buffer.concat([header, mask]);
}

interface DecodedFrame {
  opcode: number;
  payload: Buffer;
  bytesConsumed: number;
}

/** Parses a single frame off the front of `buffer`, or returns
 * `undefined` if it doesn't yet contain a complete one. Handles both
 * masked (shouldn't occur - only clients mask) and unmasked (the
 * normal case for frames from Chrome) payloads for robustness. */
function readFrame(buffer: Buffer): DecodedFrame | undefined {
  if (buffer.length < 2) {
    return undefined;
  }

  const opcode = buffer.readUInt8(0) & 0x0f;
  const masked = (buffer.readUInt8(1) & 0x80) !== 0;
  let payloadLength = buffer.readUInt8(1) & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) {
      return undefined;
    }
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) {
      return undefined;
    }
    payloadLength = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }

  let maskKey: Buffer | undefined;
  if (masked) {
    if (buffer.length < offset + 4) {
      return undefined;
    }
    maskKey = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + payloadLength) {
    return undefined;
  }

  let payload = buffer.subarray(offset, offset + payloadLength);
  if (maskKey) {
    const unmasked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) {
      unmasked.writeUInt8(payload.readUInt8(i) ^ maskKey.readUInt8(i % 4), i);
    }
    payload = unmasked;
  }

  return { opcode, payload: Buffer.from(payload), bytesConsumed: offset + payloadLength };
}
