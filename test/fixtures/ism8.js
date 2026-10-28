// -----------------------------------------------------------------------------
// Test fixtures: ISM8 frames as the ISM8 sends them, a fake ISM8 (a TCP client
// that connects to the link, as the real one does), a fake channel for the
// app, and the app on the SDK's fake Gladys with a virtual clock.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { connect } from 'node:net';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { testClock, settle } from '../kit/index.mjs';
import { Ism8App } from '../../src/app.js';
import { registerHandlers } from '../../src/handlers.js';
import { LINK } from '../../src/constants.js';
import { encodeFloat } from '../../src/ism8/datapoints.js';
import { memoryStore } from '../../src/store.js';

export { settle };

export const SELECTOR = 'test-integration';
export const ISM8_IP = '192.168.1.60';
export const CONFIG = { ism8_address: ISM8_IP };
export const WRITES = { ism8_address: ISM8_IP, allow_writes: true };
export const HOST_PORT = 41234;

export const device = (slug) => `ext:${SELECTOR}:wolf-ism8:${slug}`;
export const feature = (slug, id, suffix = '') => `${device(slug)}:dp-${id}${suffix}`;

/** Bytes of a temperature (KNX DPT 9, negative values too). */
export function temp(value) {
  if (value >= 0) return encodeFloat(value);
  let exponent = 0;
  let mantissa = Math.round(value * 100);
  while (mantissa < -2048) {
    exponent += 1;
    mantissa = Math.round((value * 100) / 2 ** exponent);
  }
  const raw = 0x8000 | (exponent << 11) | (mantissa & 0x07ff);
  return Buffer.from([raw >> 8, raw & 0xff]);
}
export const byte = (value) => Buffer.from([value]);

/** A SetDatapointValue.Req frame, as the ISM8 sends it: [[id, bytes], ...]. */
export function valuesFrame(items, { command = 0x03 } = {}) {
  const parts = items.map(([id, value]) =>
    Buffer.concat([Buffer.from([id >> 8, id & 0xff, command, value.length]), value]),
  );
  const start = items[0][0];
  const body = Buffer.concat([
    Buffer.from([0x04, 0x00, 0x00, 0x00, 0xf0, 0x06, start >> 8, start & 0xff, 0x00, items.length]),
    ...parts,
  ]);
  const size = 6 + body.length;
  return Buffer.concat([Buffer.from([0x06, 0x20, 0xf0, 0x80, size >> 8, size & 0xff]), body]);
}

/** A values message as the link sends it on the channel. */
export const valuesMessage = (session, items, at) => ({
  type: 'values',
  session,
  at,
  items: items.map(([id, value, command = 3]) => [id, command, value.toString('hex')]),
});

/** A fake ISM8: connects to the link like the real one, keeps what it receives. */
export async function fakeIsm8(port, { host = '127.0.0.1', localAddress } = {}) {
  const socket = connect({ host, port, ...(localAddress ? { localAddress } : {}) });
  const received = [];
  let closed = false;
  socket.on('data', (chunk) => received.push(chunk));
  socket.on('error', () => {});
  socket.on('close', () => {
    closed = true;
  });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return {
    socket,
    send: (data) => socket.write(data),
    get bytes() {
      return Buffer.concat(received);
    },
    get closed() {
      return closed;
    },
    close: () => socket.destroy(),
  };
}

/** The channel of the app, played by the test: `link.*` drive it like the link would. */
export class FakeChannel extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.connected = false;
    this.sent = [];
    this.starts = 0;
    /** (message) => answer fields for a write/readAll, or null for no answer. */
    this.answer = () => ({ sent: true });
  }

  start() {
    this.starts += 1;
  }

  stop() {
    this.stopped = true;
    this.connected = false;
  }

  send(message) {
    if (!this.connected) return false;
    this.sent.push(message);
    const answer = this.answer(message);
    if (answer) {
      queueMicrotask(() => this.emit('message', { type: 'result', seq: message.seq, ...answer }));
    }
    return true;
  }

  up(session = null) {
    this.connected = true;
    this.emit('up', { session, queued: 0, dropped: 0 });
  }

  down() {
    this.connected = false;
    this.emit('down');
  }

  writes(id) {
    return this.sent.filter((m) => m.type === 'write' && (id === undefined || m.id === id));
  }

  readAlls() {
    return this.sent.filter((m) => m.type === 'readAll').length;
  }
}

const recorder = (logs) =>
  Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) =>
        logs.push(
          `${level}: ${args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')}`,
        ),
    ]),
  );

export const linkContainer = (status = 'running') => ({
  name: LINK.name,
  status,
  desired: 'running',
  ports: [
    {
      container_port: LINK.ism8Port,
      protocol: 'tcp',
      host_port: HOST_PORT,
      name: LINK.portName,
      label: { en: 'x' },
      browsable: false,
    },
  ],
  devices: [],
});

/**
 * The app on the SDK's fake Gladys, a virtual clock (moving at every read),
 * a fake channel and a memory /data.
 */
export async function setup(
  t,
  {
    config = CONFIG,
    store = memoryStore(),
    containers = [linkContainer()],
    connect: doConnect = true,
    gladysOptions = {},
  } = {},
) {
  const clock = testClock();
  const gladys = createFakeGladys({ selector: SELECTOR, config, containers, ...gladysOptions });
  const logs = [];
  const channels = [];
  const app = new Ism8App({
    gladys,
    logger: recorder(logs),
    store,
    now: clock.now,
    clock: clock.monotonic,
    timers: clock.timers,
    createChannel: (options) => {
      const channel = new FakeChannel(options);
      channels.push(channel);
      return channel;
    },
  });
  registerHandlers(gladys, app);
  t.after(() => app.stop());
  await app.boot();
  if (doConnect) {
    await gladys.connect();
    await settle(20);
  }
  const channel = () => channels.at(-1);
  const at = () => new Date(clock.now()).toISOString();
  /** The ISM8 connects to the link (session `id`). */
  const ism8Up = async (id = 1) => {
    if (!channel().connected) channel().up(null);
    channel().emit('message', {
      type: 'session',
      state: 'up',
      session: id,
      from: ISM8_IP,
      at: at(),
    });
    await settle(10);
  };
  /** The ISM8 sends values (in session `id`). */
  const values = async (items, { id = app.session?.id ?? 1, stamp = at() } = {}) => {
    channel().emit('message', valuesMessage(id, items, stamp));
    await settle(10);
  };
  const advance = async (ms) => {
    await clock.advance(ms);
    await settle(10);
  };
  /**
   * A command on a feature: the clock moves until the ack (5 s at most), then
   * `wait` more; resolves with the ack.
   */
  const command = async (slug, id, value, { wait = 0 } = {}) => {
    const target = { external_id: feature(slug, id) };
    let done = false;
    const ack = gladys.fake
      .setValue({ external_id: device(slug), features: [target] }, target, value)
      .finally(() => {
        done = true;
      });
    await settle(10);
    for (let elapsed = 0; !done && elapsed < 5000; elapsed += 100) await advance(100);
    if (wait > 0) await advance(wait);
    return ack;
  };
  return {
    gladys,
    app,
    clock,
    logs,
    channel,
    channels,
    ism8Up,
    values,
    advance,
    command,
    store,
    at,
  };
}

export const status = (gladys) => gladys.fake.connectionStatus ?? { message: {} };
