/**
 * wisprClient tests.
 *
 * We test the wire protocol end-to-end against a fake
 * WebSocket. The fake implements the same surface the
 * real `WebSocket` exposes (addEventListener, send,
 * close, readyState), and lets the test drive `open` /
 * `message` / `close` events directly.
 *
 * The fake also records every `send()` payload so we
 * can assert on the protocol details (auth frame shape,
 * append positions, base64 encoding, commit count).
 *
 * Timer strategy: most tests use REAL timers (the WS
 * event handlers run on the real microtask queue, and
 * `await new Promise(r => setTimeout(r, 0))` drains
 * microtasks). The timeout test alone uses fake timers
 * so it can fast-forward 30s of wall-clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LIPI_APP_CONTEXT,
  WISPR_DEFAULT_TIMEOUT_MS,
  WISPR_WS_ENDPOINT,
  WisprClientError,
  rmsVolume,
  transcribeViaWispr,
  wisprErrorMessage,
} from './wisprClient';
import { encodeInt16AsBase64, PCM_CHUNK_SAMPLES } from './pcmCapture';

// --- mock WebSocket -------------------------------------------------------

interface FakeWebSocketListeners {
  open: Array<(ev: Event) => void>;
  message: Array<(ev: MessageEvent) => void>;
  error: Array<(ev: Event) => void>;
  close: Array<(ev: CloseEvent) => void>;
}

interface FakeWebSocket {
  url: string;
  readyState: number;
  OPEN: number;
  CLOSED: number;
  sent: string[];
  listeners: FakeWebSocketListeners;
  addEventListener: (type: string, fn: (ev: unknown) => void) => void;
  send: (data: string) => void;
  close: (code?: number) => void;
  // Test helpers
  fireOpen: () => void;
  fireMessage: (data: unknown) => void;
  fireError: () => void;
  fireClose: (code?: number, reason?: string) => void;
}

const OPEN = 1;
const CLOSED = 3;

function makeFakeWebSocket(): FakeWebSocket {
  const ws: FakeWebSocket = {
    url: '',
    readyState: OPEN,
    OPEN,
    CLOSED,
    sent: [],
    listeners: { open: [], message: [], error: [], close: [] },
    addEventListener(type, fn) {
      const t = type as keyof FakeWebSocketListeners;
      if (t in ws.listeners) ws.listeners[t].push(fn as never);
    },
    send(data) {
      ws.sent.push(data);
    },
    close() {
      ws.readyState = CLOSED;
    },
    fireOpen() {
      for (const fn of ws.listeners.open) fn(new Event('open'));
    },
    fireMessage(data) {
      for (const fn of ws.listeners.message) {
        fn(new MessageEvent('message', { data: JSON.stringify(data) }));
      }
    },
    fireError() {
      for (const fn of ws.listeners.error) fn(new Event('error'));
    },
    fireClose(code = 1000, reason = '') {
      ws.readyState = CLOSED;
      for (const fn of ws.listeners.close) {
        fn(new CloseEvent('close', { code, reason, wasClean: code === 1000 }));
      }
    },
  };
  return ws;
}

function installFakeWebSocket(): {
  ctor: new (url: string) => WebSocket;
  sockets: FakeWebSocket[];
} {
  const sockets: FakeWebSocket[] = [];
  const ctor = function FakeCtor(url: string): WebSocket {
    const ws = makeFakeWebSocket();
    ws.url = url;
    sockets.push(ws);
    return ws as unknown as WebSocket;
  } as unknown as new (url: string) => WebSocket;
  return { ctor, sockets };
}

// --- async PCM source -----------------------------------------------------

async function* fromChunks(chunks: Int16Array[]): AsyncIterable<Int16Array> {
  for (const c of chunks) yield c;
}

/** Drain microtasks via a 0ms timeout. */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

// --- tests ----------------------------------------------------------------

describe('wisprClient', () => {
  let sockets: FakeWebSocket[];
  let ctor: new (url: string) => WebSocket;
  beforeEach(() => {
    // Real timers; flush() drains microtasks.
    const f = installFakeWebSocket();
    sockets = f.sockets;
    ctor = f.ctor;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws on empty api key', async () => {
    await expect(transcribeViaWispr(fromChunks([]), '')).rejects.toBeInstanceOf(WisprClientError);
    await expect(transcribeViaWispr(fromChunks([]), '')).rejects.toMatchObject({
      code: 'no-api-key',
    });
  });

  it('opens the right endpoint with the api key in the query', async () => {
    const call = transcribeViaWispr(fromChunks([]), 'test-key-1234', { webSocketCtor: ctor });
    await flush();
    sockets[0]?.fireOpen();
    await flush();
    sockets[0]?.fireClose();
    await call.catch(() => {
      // Will reject because we closed before
      // getting a final. OK for this test.
    });
    expect(sockets[0]?.url).toContain(WISPR_WS_ENDPOINT);
    expect(sockets[0]?.url).toContain(encodeURIComponent('test-key-1234'));
  });

  it('sends an auth frame as the first message after open', async () => {
    const call = transcribeViaWispr(fromChunks([]), 'k', { webSocketCtor: ctor });
    await flush();
    sockets[0]?.fireOpen();
    await flush();
    sockets[0]?.fireClose();
    await call.catch(() => {});
    const sent = sockets[0]?.sent ?? [];
    const auth = sent.map((s) => JSON.parse(s)).find((m: { type: string }) => m.type === 'auth');
    expect(auth).toBeDefined();
    expect(auth.access_token).toBe('k');
    expect(auth.context.app).toEqual(LIPI_APP_CONTEXT);
    expect(auth.language).toEqual(['en']);
  });

  it('sends one append per PCM chunk with sequential positions', async () => {
    const chunk1 = new Int16Array(PCM_CHUNK_SAMPLES).fill(1000);
    const chunk2 = new Int16Array(PCM_CHUNK_SAMPLES).fill(-2000);
    const call = transcribeViaWispr(fromChunks([chunk1, chunk2]), 'k', { webSocketCtor: ctor });
    await flush();
    sockets[0]?.fireOpen();
    await flush();
    await flush();
    const sent = sockets[0]?.sent.map((s) => JSON.parse(s)) as Array<Record<string, unknown>>;
    const appends = sent.filter((m) => m.type === 'append');
    expect(appends.length).toBe(2);
    expect(appends[0]?.position).toBe(0);
    expect(appends[1]?.position).toBe(1);
    const commit = sent.find((m) => m.type === 'commit');
    expect(commit).toBeDefined();
    expect(commit?.total_packets).toBe(2);
    sockets[0]?.fireClose();
    await call.catch(() => {});
  });

  it('encodes the PCM chunk as base64 inside the append frame', async () => {
    const chunk = new Int16Array(PCM_CHUNK_SAMPLES);
    chunk[0] = 1;
    chunk[1] = 2;
    const call = transcribeViaWispr(fromChunks([chunk]), 'k', { webSocketCtor: ctor });
    await flush();
    sockets[0]?.fireOpen();
    await flush();
    const sent = sockets[0]?.sent.map((s) => JSON.parse(s)) as Array<Record<string, unknown>>;
    const append = sent.find((m) => m.type === 'append') as
      | { audio_packets: { packets: string[]; volumes: number[]; packet_duration: number; audio_encoding: string; byte_encoding: string } }
      | undefined;
    expect(append).toBeDefined();
    expect(append?.audio_packets.audio_encoding).toBe('wav');
    expect(append?.audio_packets.byte_encoding).toBe('base64');
    expect(append?.audio_packets.packet_duration).toBeCloseTo(0.05, 5);
    expect(append?.audio_packets.packets.length).toBe(1);
    const expected = encodeInt16AsBase64(chunk);
    expect(append?.audio_packets.packets[0]).toBe(expected);
    expect(append?.audio_packets.volumes[0]).toBeGreaterThan(0);
    expect(append?.audio_packets.volumes[0]).toBeLessThanOrEqual(1);
    sockets[0]?.fireClose();
    await call.catch(() => {});
  });

  it('resolves with the final transcript when a final text frame arrives', async () => {
    const call = transcribeViaWispr(fromChunks([]), 'k', { webSocketCtor: ctor });
    await flush();
    sockets[0]?.fireOpen();
    await flush();
    sockets[0]?.fireMessage({ status: 'auth' });
    sockets[0]?.fireMessage({
      status: 'text',
      body: { text: 'hello world', final: true },
    });
    const out = await call;
    expect(out).toBe('hello world');
  });

  it('rejects with auth-rejected on a server error mentioning auth', async () => {
    const call = transcribeViaWispr(fromChunks([]), 'k', { webSocketCtor: ctor });
    await flush();
    sockets[0]?.fireOpen();
    await flush();
    sockets[0]?.fireMessage({ error: 'unauthorized' });
    await expect(call).rejects.toMatchObject({ code: 'auth-rejected' });
  });

  it('rejects with timeout if no message arrives in the timeout window', async () => {
    // This test uses fake timers so we can
    // fast-forward 30s.
    vi.useFakeTimers();
    const local = installFakeWebSocket();
    const localSockets = local.sockets;
    // Attach a no-op rejection handler IMMEDIATELY
    // so the rejection is "handled" the moment it
    // fires, rather than being flagged as
    // unhandled by Node's warning.
    const call = transcribeViaWispr(fromChunks([]), 'k', { webSocketCtor: local.ctor });
    call.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    localSockets[0]?.fireOpen();
    await vi.advanceTimersByTimeAsync(0);
    // No activity; advance the clock past the
    // default 30s timeout.
    await vi.advanceTimersByTimeAsync(WISPR_DEFAULT_TIMEOUT_MS + 1);
    await expect(call).rejects.toMatchObject({ code: 'timeout' });
    vi.useRealTimers();
  });
});

describe('rmsVolume', () => {
  it('is 0 for an empty array', () => {
    expect(rmsVolume(new Int16Array(0))).toBe(0);
  });

  it('is 0 for all-zero samples', () => {
    expect(rmsVolume(new Int16Array(100))).toBe(0);
  });

  it('is ~1 for full-scale samples', () => {
    const samples = new Int16Array(100).fill(32767);
    expect(rmsVolume(samples)).toBeCloseTo(32767 / 32768, 2);
  });

  it('is in [0, 1] for any input', () => {
    const samples = new Int16Array(100);
    for (let i = 0; i < 100; i++) samples[i] = Math.floor(Math.random() * 65536) - 32768;
    const v = rmsVolume(samples);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});

describe('wisprErrorMessage', () => {
  it('returns a no-key message for no-api-key', () => {
    expect(wisprErrorMessage('no-api-key')).toMatch(/No Wispr API key/i);
  });
  it('returns an auth message for auth-rejected', () => {
    expect(wisprErrorMessage('auth-rejected')).toMatch(/rejected|api key/i);
  });
  it('returns a rate message for rate-limited', () => {
    expect(wisprErrorMessage('rate-limited')).toMatch(/rate/i);
  });
  it('returns a network message for network', () => {
    expect(wisprErrorMessage('network')).toMatch(/network|connection/i);
  });
  it('returns a fallback for unknown codes', () => {
    expect(wisprErrorMessage('server-error')).toMatch(/failed|try again/i);
  });
});
