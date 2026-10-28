// -----------------------------------------------------------------------------
// The `ism8-link` sub-container on real loopback sockets: a fake ISM8 that
// connects like the real one, the real channel client of the main container.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { ChannelClient } from '../src/channel.js';
import { LIMITS } from '../src/constants.js';
import { startLinkService } from '../src/link/service.js';
import { REQUEST_ALL, ackFrame } from '../src/ism8/protocol.js';
import { fakeIsm8, temp, valuesFrame } from './fixtures/ism8.js';

const TOKEN = 'c'.repeat(43);
const quiet = { debug() {}, info() {}, warn() {}, error() {} };
const until = async (check, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

async function start(t, env = {}) {
  const link = await startLinkService({
    env: {
      CHANNEL_TOKEN: TOKEN,
      ISM8_PORT: '0',
      CHANNEL_PORT: '0',
      ISM8_ADDRESS: '127.0.0.1',
      ...env,
    },
    logger: quiet,
  });
  const messages = [];
  const client = new ChannelClient({
    host: '127.0.0.1',
    port: link.channel.port,
    token: TOKEN,
    delays: [50],
  });
  client.on('message', (m) => messages.push(m));
  const up = new Promise((resolve) => client.once('up', resolve));
  client.start();
  const info = await up;
  t.after(async () => {
    client.stop();
    await link.stop();
  });
  return { link, client, messages, info, port: link.port };
}

test('a valid frame is acknowledged at once and handed over undecoded', async (t) => {
  const { client, messages, port } = await start(t);
  const ism8 = await fakeIsm8(port);
  await until(() => messages.some((m) => m.type === 'session' && m.state === 'up'));
  ism8.send(
    valuesFrame([
      [4, temp(60)],
      [8, temp(12)],
    ]),
  );
  await until(() => messages.some((m) => m.type === 'values'));
  const values = messages.find((m) => m.type === 'values');
  assert.deepEqual(values.items, [
    [4, 3, temp(60).toString('hex')],
    [8, 3, temp(12).toString('hex')],
  ]);
  await until(() => ism8.bytes.length >= 17);
  assert.deepEqual(ism8.bytes.subarray(0, 17), ackFrame(4));
  // A write and a full read leave towards the ISM8 as frames.
  const session = values.session;
  client.send({ type: 'write', seq: 1, session, id: 56, hex: temp(55).toString('hex') });
  client.send({ type: 'readAll', seq: 2, session });
  await until(() => messages.filter((m) => m.type === 'result').length === 2);
  assert.ok(messages.filter((m) => m.type === 'result').every((m) => m.sent === true));
  await until(() => ism8.bytes.length >= 17 + 22 + 12);
  const written = ism8.bytes.subarray(17);
  assert.deepEqual(
    [...written.subarray(0, 22)],
    [
      0x06,
      0x20,
      0xf0,
      0x80,
      0x00,
      0x16,
      0x04,
      0,
      0,
      0,
      0xf0,
      0xc1,
      0,
      56,
      0,
      1,
      0,
      56,
      0,
      2,
      ...temp(55),
    ],
  );
  assert.deepEqual(written.subarray(22, 34), REQUEST_ALL);
});

test('a connection from another address is closed before any byte is read, and told', async (t) => {
  const { messages, port } = await start(t, { ISM8_ADDRESS: '127.0.0.2' });
  const other = await fakeIsm8(port);
  other.send(valuesFrame([[4, temp(60)]]));
  await until(() => other.closed);
  await until(() => messages.some((m) => m.type === 'refused'));
  assert.equal(messages.find((m) => m.type === 'refused').from, '127.0.0.1');
  assert.ok(!messages.some((m) => m.type === 'values' || m.type === 'session'));
});

test('one session at a time: a new connection of the ISM8 replaces the old one', async (t) => {
  const { messages, port } = await start(t);
  const first = await fakeIsm8(port);
  await until(() => messages.filter((m) => m.type === 'session' && m.state === 'up').length === 1);
  const second = await fakeIsm8(port);
  await until(() => first.closed);
  await until(() => messages.filter((m) => m.type === 'session' && m.state === 'up').length === 2);
  const ups = messages.filter((m) => m.type === 'session' && m.state === 'up');
  assert.ok(ups[1].session > ups[0].session);
  assert.ok(
    messages.some(
      (m) => m.type === 'session' && m.state === 'down' && m.session === ups[0].session,
    ),
  );
  assert.equal(second.closed, false);
});

test('bounded: garbage, an oversized size, a malformed frame close the connection', async (t) => {
  const { messages, port } = await start(t);
  const cases = [
    Buffer.from('GET / HTTP/1.1\r\n\r\n'),
    Buffer.from([0x06, 0x20, 0xf0, 0x80, 0xff, 0xff]),
    // count says 2, one datapoint inside
    Buffer.from([
      0x06, 0x20, 0xf0, 0x80, 0x00, 0x15, 4, 0, 0, 0, 0xf0, 0x06, 0, 4, 0, 2, 0, 4, 3, 1, 0x10,
    ]),
  ];
  for (const bytes of cases) {
    const ism8 = await fakeIsm8(port);
    ism8.send(bytes);
    await until(() => ism8.closed);
  }
  assert.ok(!messages.some((m) => m.type === 'values'));
});

test('an incomplete frame is not kept: the connection closes after 5 s', async (t) => {
  const link = await startLinkService({
    env: { CHANNEL_TOKEN: TOKEN, ISM8_PORT: '0', CHANNEL_PORT: '0' },
    logger: quiet,
    // 5 s become 50 ms
    timers: { setTimeout: (fn, ms) => setTimeout(fn, ms / 100), clearTimeout },
  });
  t.after(() => link.stop());
  const ism8 = await fakeIsm8(link.port);
  ism8.send(valuesFrame([[4, temp(60)]]).subarray(0, 12));
  await until(() => ism8.closed, 1000);
});

test('4 connections at most; the sender check off accepts any address', async (t) => {
  const { port } = await start(t, { ISM8_ADDRESS: '' });
  const sockets = [];
  for (let i = 0; i < LIMITS.linkSockets + 2; i += 1) {
    const socket = connect({ host: '127.0.0.1', port });
    socket.on('error', () => {});
    sockets.push(socket);
  }
  t.after(() => sockets.forEach((s) => s.destroy()));
  // Only the newest is the session; the others were replaced or refused, never more than 4 open.
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.ok(
    sockets.filter((s) => !s.destroyed && s.readyState === 'open').length <= LIMITS.linkSockets,
  );
});

test('too many frames in 10 s close the connection', async (t) => {
  const { port } = await start(t);
  const ism8 = await fakeIsm8(port);
  const frame = valuesFrame([[4, temp(60)]]);
  ism8.send(Buffer.concat(Array.from({ length: LIMITS.frames + 5 }, () => frame)));
  await until(() => ism8.closed);
});

test('writes: refused for another session, an invalid id or value, or over the rate', async (t) => {
  const { client, messages, port } = await start(t);
  const ism8 = await fakeIsm8(port);
  await until(() => messages.some((m) => m.type === 'session' && m.state === 'up'));
  const session = messages.find((m) => m.type === 'session').session;
  client.send({ type: 'write', seq: 1, session: session + 1, id: 56, hex: '0c1a' });
  client.send({ type: 'write', seq: 2, session, id: 0, hex: '0c1a' });
  client.send({ type: 'write', seq: 3, session, id: 56, hex: 'zz' });
  client.send({ type: 'write', seq: 4, session, id: 56, hex: '0011223344' });
  await until(() => messages.filter((m) => m.type === 'result').length === 4);
  const results = messages.filter((m) => m.type === 'result');
  assert.deepEqual(
    results.map((r) => [r.seq, r.sent, r.reason]),
    [
      [1, false, 'session'],
      [2, false, 'invalid'],
      [3, false, 'invalid'],
      [4, false, 'invalid'],
    ],
  );
  for (let i = 0; i < LIMITS.linkWrites + 3; i += 1)
    client.send({ type: 'write', seq: 10 + i, session, id: 57, hex: '00' });
  await until(
    () => messages.filter((m) => m.type === 'result').length === 4 + LIMITS.linkWrites + 3,
  );
  assert.equal(messages.filter((m) => m.type === 'result' && m.reason === 'rate').length, 3);
  assert.equal(ism8.closed, false);
});

test('the channel refuses a client without the secret', async (t) => {
  const { link } = await start(t);
  const intruder = new ChannelClient({
    host: '127.0.0.1',
    port: link.channel.port,
    token: 'd'.repeat(43),
    delays: [10_000],
  });
  let up = false;
  intruder.on('up', () => (up = true));
  intruder.start();
  await new Promise((resolve) => setTimeout(resolve, 200));
  intruder.stop();
  assert.equal(up, false);
});

test('sockets still closing count: a fifth one in a burst is closed at once', async (t) => {
  const { EventEmitter } = await import('node:events');
  const link = await startLinkService({
    env: { CHANNEL_TOKEN: TOKEN, ISM8_PORT: '0', CHANNEL_PORT: '0' },
    logger: quiet,
  });
  t.after(() => link.stop());
  const fake = () => {
    const socket = new EventEmitter();
    socket.remoteAddress = '127.0.0.1';
    socket.destroyed = false;
    socket.destroy = () => {
      socket.destroyed = true; // 'close' comes later, as on a real socket
    };
    socket.setNoDelay = () => {};
    socket.setKeepAlive = () => {};
    socket.write = () => true;
    return socket;
  };
  const sockets = Array.from({ length: 5 }, fake);
  for (const socket of sockets) link.server.emit('connection', socket);
  assert.equal(link.session().socket, sockets[3], 'the fifth never became the session');
  assert.equal(sockets[4].destroyed, true);
});

test('a stop is never refused for the rate; "stop" must be a standby; last-hop checks', async (t) => {
  const { client, messages, port } = await start(t);
  const ism8 = await fakeIsm8(port);
  await until(() => messages.some((m) => m.type === 'session' && m.state === 'up'));
  const session = messages.find((m) => m.type === 'session').session;
  for (let i = 0; i < LIMITS.linkWrites; i += 1)
    client.send({ type: 'write', seq: 100 + i, session, id: 57, hex: '00' });
  client.send({ type: 'write', seq: 1, session, id: 57, hex: '00' });
  client.send({ type: 'write', seq: 2, session, id: 57, hex: '02', stop: true });
  client.send({ type: 'write', seq: 3, session, id: 58, hex: '04', stop: true });
  client.send({ type: 'write', seq: 4, session, id: 57, hex: '00', stop: true });
  client.send({ type: 'write', seq: 5, session, id: 199, hex: '0c1a', stop: false });
  client.send({ type: 'write', seq: 6, session, id: 56, hex: temp(66).toString('hex') });
  client.send({ type: 'write', seq: 7, session, id: 57, hex: '04' });
  client.send({ type: 'write', seq: 8, session, id: 56, hex: temp(55.5).toString('hex') });
  await until(() => messages.filter((m) => m.type === 'result').length === LIMITS.linkWrites + 8);
  const result = (seq) => messages.find((m) => m.type === 'result' && m.seq === seq);
  assert.equal(result(1).reason, 'rate');
  assert.equal(result(2).sent, true, 'a stop over the rate leaves');
  assert.equal(result(3).sent, true);
  assert.equal(result(4).reason, 'invalid', 'a "stop" that is not standby');
  for (const seq of [5, 6, 7, 8]) assert.equal(result(seq).reason, 'invalid', `seq ${seq}`);
  assert.equal(ism8.closed, false);
});

test('two full dumps of 300 frames of one datapoint each keep the session', async (t) => {
  const { messages, port } = await start(t);
  const ism8 = await fakeIsm8(port);
  await until(() => messages.some((m) => m.type === 'session' && m.state === 'up'));
  ism8.send(
    Buffer.concat(Array.from({ length: 600 }, (_, i) => valuesFrame([[1 + (i % 250), temp(20)]]))),
  );
  await until(() => messages.filter((m) => m.type === 'values').length === 600);
  assert.equal(ism8.closed, false);
});

test('a frame from the field with an empty datapoint is acknowledged, the session kept', async (t) => {
  const { messages, port } = await start(t);
  const ism8 = await fakeIsm8(port);
  // wolf_ism8 tests, "network msg from github": datapoint 178, length 0.
  ism8.send(Buffer.from('0620f080001404000000f00600b2000100b20300', 'hex'));
  await until(() => ism8.bytes.length >= 17);
  assert.deepEqual(ism8.bytes.subarray(0, 17), ackFrame(0xb2));
  assert.equal(ism8.closed, false);
  assert.ok(!messages.some((m) => m.type === 'values'));
});

test('the link refuses a client whose proof is wrong, and takes no message from it', async (t) => {
  const { link, port } = await start(t);
  const ism8 = await fakeIsm8(port);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const raw = connect({ host: '127.0.0.1', port: link.channel.port });
  const lines = [];
  raw.on('data', (d) => lines.push(...d.toString().split('\n').filter(Boolean)));
  raw.on('error', () => {});
  let closed = false;
  raw.on('close', () => (closed = true));
  await until(() => lines.length >= 1);
  raw.write(`${JSON.stringify({ type: 'hello', nonce: 'a'.repeat(32), proof: 'b'.repeat(64) })}\n`);
  raw.write(`${JSON.stringify({ type: 'readAll', seq: 1, session: 1 })}\n`);
  await until(() => closed);
  assert.ok(!lines.some((l) => l.includes('"ready"')));
  assert.equal(ism8.bytes.length, 0, 'nothing written to the ISM8');
});

test('the main container refuses a link that does not prove the secret', async (t) => {
  const { createServer } = await import('node:net');
  const server = createServer((socket) => {
    socket.on('error', () => {});
    socket.write(`${JSON.stringify({ type: 'challenge', nonce: 'c'.repeat(32) })}\n`);
    socket.on('data', () => {
      socket.write(`${JSON.stringify({ type: 'ready', proof: 'd'.repeat(64), session: null })}\n`);
      socket.write(
        `${JSON.stringify({ type: 'values', session: 1, at: new Date().toISOString(), items: [] })}\n`,
      );
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const client = new ChannelClient({
    host: '127.0.0.1',
    port: server.address().port,
    token: TOKEN,
    delays: [10_000],
  });
  let up = false;
  const messages = [];
  client.on('up', () => (up = true));
  client.on('message', (m) => messages.push(m));
  client.start();
  await new Promise((resolve) => setTimeout(resolve, 300));
  client.stop();
  assert.equal(up, false);
  assert.equal(messages.length, 0);
});

test('one "request all" per 30 s, whoever asks', async (t) => {
  const { client, messages, port } = await start(t);
  const ism8 = await fakeIsm8(port);
  await until(() => messages.some((m) => m.type === 'session' && m.state === 'up'));
  const session = messages.find((m) => m.type === 'session').session;
  client.send({ type: 'readAll', seq: 1, session });
  client.send({ type: 'readAll', seq: 2, session });
  await until(() => messages.filter((m) => m.type === 'result').length === 2);
  const results = messages.filter((m) => m.type === 'result');
  assert.deepEqual(
    results.map((r) => r.sent),
    [true, false],
  );
  assert.equal(results[1].reason, 'rate');
  assert.equal(ism8.closed, false);
});
