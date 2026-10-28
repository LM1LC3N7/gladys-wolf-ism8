// -----------------------------------------------------------------------------
// End to end on a REAL clock sped up 20 times (testkit realClock): the real
// link service on loopback, the real channel, the app on the SDK's fake
// Gladys, and a fake ISM8 that connects like the real one and answers the
// writes with the new value, as the ISM8 reports a changed datapoint.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { measurePeriod, realClock, spyOn } from './kit/index.mjs';
import { Ism8App } from '../src/app.js';
import { ChannelClient } from '../src/channel.js';
import { TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { startLinkService } from '../src/link/service.js';
import { memoryStore } from '../src/store.js';
import { REQUEST_ALL } from '../src/ism8/protocol.js';
import { byte, fakeIsm8, feature, linkContainer, temp, valuesFrame } from './fixtures/ism8.js';

const quiet = process.env.DEBUG_TEST
  ? { debug: console.log, info: console.log, warn: console.log, error: console.log }
  : { debug() {}, info() {}, warn() {}, error() {} };
const until = async (check, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

/**
 * Frames the main container sent to the ISM8: [{ id, value hex } | 'readAll' | 'ack'].
 * "Request all" is 12 bytes although its size field says 22 (as wolf_ism8 sends it).
 */
function ism8Inbox(ism8) {
  let pending = Buffer.alloc(0);
  const inbox = [];
  ism8.socket.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      if (pending.length >= 12 && pending.subarray(0, 12).equals(REQUEST_ALL)) {
        inbox.push('readAll');
        pending = pending.subarray(12);
        continue;
      }
      if (pending.length < 6) break;
      const size = pending.readUInt16BE(4);
      if (pending.length < size) break;
      const frame = pending.subarray(0, size);
      pending = pending.subarray(size);
      if (frame[11] === 0xc1)
        inbox.push({ id: frame.readUInt16BE(16), hex: frame.subarray(20).toString('hex') });
      else inbox.push('ack');
    }
  });
  return inbox;
}

test('real clock x20: values, a confirmed write, an immediate stop, a 10 s round', async (t) => {
  const clock = realClock({ speed: 20 });
  const token = 'e'.repeat(43);
  const store = memoryStore({ token });
  const link = await startLinkService({
    env: { CHANNEL_TOKEN: token, ISM8_PORT: '0', CHANNEL_PORT: '0', ISM8_ADDRESS: '127.0.0.1' },
    logger: quiet,
  });
  const gladys = createFakeGladys({
    config: { ism8_address: '127.0.0.1', allow_writes: true },
    containers: [linkContainer()],
  });
  const app = new Ism8App({
    gladys,
    logger: quiet,
    store,
    now: clock.now,
    clock: clock.monotonic,
    timers: clock.timers,
    createChannel: (options) =>
      new ChannelClient({ ...options, host: '127.0.0.1', port: link.channel.port, delays: [20] }),
  });
  t.after(async () => {
    await app.stop();
    await link.stop();
    clock.close();
  });
  await app.boot();
  registerHandlers(gladys, app);
  await gladys.connect();
  await until(() => app.channel?.connected);

  const ism8 = await fakeIsm8(link.port);
  const inbox = ism8Inbox(ism8);
  // The ISM8 applies a write and reports the new value; "request all" sends every value.
  const state = new Map([
    [56, temp(50)],
    [57, byte(0)],
    [4, temp(48)],
  ]);
  ism8.socket.on('data', () => {
    for (const entry of inbox.splice(0)) {
      if (entry?.id) {
        state.set(entry.id, Buffer.from(entry.hex, 'hex'));
        ism8.send(valuesFrame([[entry.id, state.get(entry.id)]]));
      }
      if (entry === 'readAll') for (const item of state) ism8.send(valuesFrame([item]));
    }
  });
  await until(() => app.session);
  // As a real ISM8 at connection: every value, one datapoint per frame.
  for (const item of state) ism8.send(valuesFrame([item]));
  await until(() => gladys.fake.lastState(feature('appliance-1', 4)) === 48);

  const target = (id) => ({ external_id: feature('direct-circuit', id) });
  const device = { external_id: 'ext:test-integration:wolf-ism8:direct-circuit' };
  const started = performance.now();
  const ack = await gladys.fake.setValue(device, target(56), 55);
  assert.equal(ack.success, true);
  assert.deepEqual(ack.data, { confirmed: true });
  assert.ok(
    (performance.now() - started) * clock.speed < TIMINGS.commandAnswer,
    'answered within 3.4 s',
  );
  await until(() => gladys.fake.lastState(feature('direct-circuit', 56)) === 55);

  // The stop: sent at once (writes allowed or not), confirmed by the value read back.
  await gladys.fake.configUpdated({ ism8_address: '127.0.0.1', allow_writes: false });
  const stopAck = await gladys.fake.setValue(device, target(57), 'standby');
  assert.deepEqual(stopAck.data, { confirmed: true });
  assert.equal(store.data.stops['57'].confirmed, true);

  // The background round: every 10 s (0.5 s real), never faster.
  const spy = spyOn(app, 'tick', clock);
  await measurePeriod(spy, { count: 4, period: TIMINGS.tick });
  spy.restore();
  // The stop stays while the ISM8 keeps reporting standby (follow-up reads included).
  assert.equal(store.data.stops['57'].confirmed, true);
  assert.equal(gladys.fake.lastState(feature('direct-circuit', 57)), 'standby');
});
