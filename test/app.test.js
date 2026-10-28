// -----------------------------------------------------------------------------
// The app on the SDK's fake Gladys (the real handlers of src/handlers.js), a
// virtual clock that moves at every read, a fake channel played as the link.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINK, MINUTE, SECOND } from '../src/constants.js';
import { memoryStore } from '../src/store.js';
import {
  CONFIG,
  HOST_PORT,
  ISM8_IP,
  WRITES,
  byte,
  device,
  feature,
  setup,
  status,
  temp,
} from './fixtures/ism8.js';

const startCalls = (gladys) => gladys.fake.bodies('POST', `/container/${LINK.name}/start`);
const stopCalls = (gladys) => gladys.fake.bodies('POST', `/container/${LINK.name}/stop`);

test('without an address nothing listens: the link is never started, the status asks for it', async (t) => {
  const { gladys, channels } = await setup(t, { config: {} });
  assert.equal(startCalls(gladys).length, 0);
  // A link left running from before (address cleared while the integration was stopped) is stopped.
  assert.equal(stopCalls(gladys).length, 1);
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.fr, /adresse IP de l’ISM8i/);
  // The channel only knocks at a link that may run from before (a kept stop): nothing listens here.
  assert.equal(channels.length, 1);
});

test('an invalid address (name, broadcast, multicast, 0.0.0.0) is refused, the link stopped', async (t) => {
  for (const address of [
    'ism8.local',
    '255.255.255.255',
    '224.0.0.1',
    '0.0.0.0',
    '192.168.1.60:12004',
  ]) {
    const { gladys } = await setup(t, { config: { ism8_address: address } });
    assert.equal(startCalls(gladys).length, 0, address);
    assert.match(status(gladys).message.en, /not a valid IP address/, address);
  }
});

test('a saved address starts the link with the address checked and the channel secret', async (t) => {
  const ctx = await setup(t);
  const { gladys, store } = ctx;
  const [body] = startCalls(gladys);
  assert.equal(body.env.ISM8_ADDRESS, ISM8_IP);
  assert.equal(body.env.ISM8_PORT, '12004');
  assert.equal(body.env.CHANNEL_PORT, String(LINK.channelPort));
  assert.equal(body.env.CHANNEL_TOKEN, store.data.token);
  assert.match(status(gladys).message.en, /does not answer this container yet/);
  ctx.channel().up(null);
  await ctx.advance(100);
  assert.match(status(gladys).message.fr, new RegExp(`le port ${HOST_PORT}`));
});

test('the sender check off: the link accepts any address (ISM8_ADDRESS not given)', async (t) => {
  const { gladys } = await setup(t, { config: { ...CONFIG, check_source: false } });
  assert.equal(startCalls(gladys)[0].env.ISM8_ADDRESS, undefined);
});

test('the address removed: the link is stopped (nothing listens)', async (t) => {
  const { gladys } = await setup(t);
  await gladys.fake.configUpdated({ ism8_address: '' });
  assert.equal(stopCalls(gladys).length, 1);
  assert.match(status(gladys).message.en, /Type the IP address/);
});

test('values: decoded, published, devices discovered with their features; texts never as 0', async (t) => {
  const { gladys, ism8Up, values, advance, channel } = await setup(t);
  await ism8Up();
  assert.equal(channel().readAlls(), 1, 'a full read at the new session');
  await values([
    [4, temp(61)],
    [8, temp(-3.2)],
    [2, byte(1)],
    [1, byte(0)],
    [13, temp(1.8)],
    [55, temp(21)],
    [57, byte(0)],
    [58, byte(4)],
    [56, temp(50)],
    [372, byte(0)],
    [767, byte(1)],
  ]);
  await advance(2 * SECOND);
  assert.equal(gladys.fake.lastState(feature('appliance-1', 4)), 61);
  assert.equal(gladys.fake.lastState(feature('appliance-1', 8)), -3.2);
  assert.equal(gladys.fake.lastState(feature('appliance-1', 2)), 'Chauffage');
  assert.equal(gladys.fake.lastState(feature('appliance-1', 1)), 0);
  assert.equal(gladys.fake.lastState(feature('direct-circuit', 57)), 'auto');
  assert.equal(gladys.fake.lastState(feature('direct-circuit', 57, '-text')), 'Automatique');
  assert.equal(gladys.fake.lastState(feature('direct-circuit', 58)), 'standby');
  assert.equal(gladys.fake.lastState(feature('direct-circuit', 56)), 50);
  assert.equal(gladys.fake.lastState(feature('system', 372)), 'Aucun');
  const discovered = gladys.fake.discoveredDevices;
  assert.deepEqual(discovered.map((d) => d.external_id).sort(), [
    device('appliance-1'),
    device('direct-circuit'),
    device('system'),
  ]);
  const direct = discovered.find((d) => d.external_id === device('direct-circuit'));
  const byId = Object.fromEntries(direct.features.map((f) => [f.external_id, f]));
  assert.equal(byId[feature('direct-circuit', 56)].category, 'water-heater');
  assert.equal(byId[feature('direct-circuit', 56)].max, 65);
  assert.equal(byId[feature('direct-circuit', 57)].type, 'select');
  assert.equal(byId[feature('direct-circuit', 57, '-text')].read_only, true);
  assert.equal(byId[feature('direct-circuit', 55)].type, 'decimal');
  // The keep-alive is never a feature; texts are text features.
  assert.ok(!JSON.stringify(discovered).includes('dp-767'));
  for (const f of discovered.flatMap((d) => d.features)) {
    if (f.type === 'binary') assert.equal(f.read_only, true);
  }
});

test('stale values (kept by the link while this container was away) are not published', async (t) => {
  const { gladys, ism8Up, values, advance, clock } = await setup(t);
  await ism8Up();
  await values([[4, temp(70)]], { stamp: new Date(clock.now() - 2 * MINUTE).toISOString() });
  await advance(2 * SECOND);
  assert.equal(gladys.fake.lastState(feature('appliance-1', 4)), undefined);
  // Values of another session neither.
  await values([[4, temp(70)]], { id: 99 });
  await advance(2 * SECOND);
  assert.equal(gladys.fake.lastState(feature('appliance-1', 4)), undefined);
});

test('implausible and invalid values are never published', async (t) => {
  const { gladys, ism8Up, values, advance } = await setup(t);
  await ism8Up();
  await values([
    [4, Buffer.from([0x7f, 0xff])],
    [5, temp(500)],
    [6, byte(1)],
    [7, temp(40), 2],
  ]);
  await advance(2 * SECOND);
  for (const id of [4, 5, 6, 7])
    assert.equal(gladys.fake.lastState(feature('appliance-1', id)), undefined, id);
});

// --- Writes -----------------------------------------------------------------------------

async function ready(t, options = {}) {
  const ctx = await setup(t, { config: WRITES, ...options });
  await ctx.ism8Up();
  await ctx.values([
    [56, temp(50)],
    [57, byte(0)],
    [58, byte(0)],
  ]);
  return ctx;
}

/** The fake link echoes every write as the ISM8 would report the new value. */
function echo(ctx, { delay = 300 } = {}) {
  ctx.channel().answer = (message) => {
    if (message.type === 'write') {
      ctx.clock.timers.setTimeout(() => {
        ctx.channel().emit('message', {
          type: 'values',
          session: ctx.app.session.id,
          at: ctx.at(),
          items: [[message.id, 3, message.hex]],
        });
      }, delay);
    }
    return { sent: true };
  };
}

test('writes off: a setpoint is refused, nothing sent', async (t) => {
  const ctx = await ready(t, { config: CONFIG });
  const ack = await ctx.command('direct-circuit', 56, 55);
  assert.equal(ack.success, false);
  assert.match(ack.error, /writes are off/);
  assert.equal(ctx.channel().writes().length, 0);
});

test('a setpoint within the ceiling: sent once, confirmed by the value read back', async (t) => {
  const ctx = await ready(t);
  echo(ctx);
  const ack = await ctx.command('direct-circuit', 56, 55);
  assert.equal(ack.success, true);
  assert.deepEqual(ack.data ?? {}, ack.data ?? {});
  const writes = ctx.channel().writes(56);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].hex, temp(55).toString('hex'));
  assert.match(status(ctx.gladys).message.en, /applied \(read back\)/);
});

test('hot water: above 65 °C or the configured ceiling is refused, whatever the input', async (t) => {
  const ctx = await ready(t, { config: { ...WRITES, dhw_max_temperature: 55 } });
  for (const value of [56, 66, 80, 65.5, '60', '', null, '1e2', true, 'abc', -5]) {
    const ack = await ctx.command('direct-circuit', 56, value, { wait: 100 });
    assert.equal(ack.success, false, String(value));
  }
  assert.equal(ctx.channel().writes().length, 0);
  // A ceiling typed above 65 stays at 65.
  await ctx.gladys.fake.configUpdated({ ...WRITES, dhw_max_temperature: 90 });
  assert.equal(ctx.app.config.dhwCap, 65);
  assert.equal((await ctx.command('direct-circuit', 56, 66, { wait: 100 })).success, false);
  assert.equal(ctx.channel().writes().length, 0);
});

test('a write without its echo: "sent, without confirmation", follow-up reads', async (t) => {
  const ctx = await ready(t);
  const before = ctx.channel().readAlls();
  const ack = await ctx.command('direct-circuit', 56, 60);
  assert.equal(ack.success, true);
  assert.match(status(ctx.gladys).message.en, /sent, without confirmation/);
  await ctx.advance(25 * SECOND);
  assert.ok(ctx.channel().readAlls() >= before + 2, 'echo read and follow-ups');
});

test('a read back equal to the value before is not a confirmation', async (t) => {
  const ctx = await ready(t);
  ctx.channel().answer = (message) => {
    if (message.type === 'write') {
      ctx.clock.timers.setTimeout(() => {
        ctx.channel().emit('message', {
          type: 'values',
          session: ctx.app.session.id,
          at: ctx.at(),
          items: [[56, 3, temp(50).toString('hex')]],
        });
      }, 200);
    }
    return { sent: true };
  };
  await ctx.command('direct-circuit', 56, 60);
  assert.match(status(ctx.gladys).message.en, /sent, without confirmation/);
});

test('the value must have been read in the current ISM8 session', async (t) => {
  const ctx = await ready(t);
  await ctx.ism8Up(2);
  const ack = await ctx.command('direct-circuit', 56, 55);
  assert.equal(ack.success, false);
  assert.match(ack.error, /not read since the ISM8i connected/);
  assert.equal(ctx.channel().writes().length, 0);
});

test('the link refusing the write (another session): "not sent"', async (t) => {
  const ctx = await ready(t);
  ctx.channel().answer = () => ({ sent: false, reason: 'session' });
  const ack = await ctx.command('direct-circuit', 57, 'comfort');
  assert.equal(ack.success, false);
  assert.match(ack.error, /receiver did not take it/);
});

test('the option turned off between the click and the send stops the write', async (t) => {
  const ctx = await ready(t);
  const dp = (await import('../src/ism8/datapoints.js')).DATAPOINTS.get(56);
  ctx.app.config = { ...ctx.app.config, allowWrites: false };
  const why = ctx.app.beforeSend(dp, 55, {
    epoch: 0,
    session: ctx.app.session.id,
    received: ctx.clock.monotonic(),
  });
  assert.match(why.en, /writes are off/);
  ctx.app.config = { ...ctx.app.config, allowWrites: true, dhwCap: 50 };
  const above = ctx.app.beforeSend(dp, 55, {
    epoch: 0,
    session: ctx.app.session.id,
    received: ctx.clock.monotonic(),
  });
  assert.match(above.en, /ceiling of 50/);
});

test('programs: only the offered keys; the read-only twin shows the others', async (t) => {
  const ctx = await ready(t);
  for (const value of ['frost-protection', 'cooling', 2, '', 'Standby']) {
    const ack = await ctx.command('direct-circuit', 57, value, { wait: 100 });
    assert.equal(ack.success, false, String(value));
  }
  await ctx.values([[57, byte(4)]]);
  await ctx.advance(2 * SECOND);
  assert.equal(ctx.gladys.fake.lastState(feature('direct-circuit', 57)), 'auto');
  assert.equal(ctx.gladys.fake.lastState(feature('direct-circuit', 57, '-text')), 'Hors-gel');
});

test('a read-only datapoint is never written', async (t) => {
  const ctx = await ready(t);
  const ack = await ctx.command('appliance-1', 199, 50, { wait: 100 });
  assert.equal(ack.success, false);
  assert.equal(ctx.channel().writes().length, 0);
});

// --- The stop -----------------------------------------------------------------------------

test('standby is always sent: writes off, no value read, a setting busy', async (t) => {
  const ctx = await setup(t);
  await ctx.ism8Up();
  const ack = await ctx.command('direct-circuit', 57, 'standby');
  assert.equal(ack.success, true);
  const [write] = ctx.channel().writes(57);
  assert.equal(write.hex, '02');
  assert.equal(ctx.store.data.stops['57'].attempts, 1);
  // The hot water too.
  await ctx.command('mixer-circuit-2', 84, 'standby');
  assert.equal(ctx.channel().writes(84)[0].hex, '04');
});

test('standby without the ISM8: kept in /data, sent at its next session', async (t) => {
  const ctx = await setup(t);
  const ack = await ctx.command('direct-circuit', 58, 'standby', { wait: 100 });
  assert.equal(ack.success, true);
  assert.equal(ctx.store.data.stops['58'].attempts, 0);
  assert.match(status(ctx.gladys).message.en, /stop kept|stop\(s\) waiting/);
  await ctx.ism8Up();
  assert.equal(ctx.channel().writes(58).length, 1);
});

test('a stop kept in /data leaves at start-up before the configuration is read', async (t) => {
  const store = memoryStore({
    token: 'a'.repeat(43),
    seen: [57],
    stops: { 57: { at: 1, attempts: 0, confirmed: false } },
  });
  const ctx = await setup(t, { store, connect: false });
  // Gladys not even connected: the link (running from before) answers the channel.
  ctx.channel().up({ id: 3, from: ISM8_IP });
  await ctx.advance(100);
  const [write] = ctx.channel().writes(57);
  assert.equal(write.hex, '02');
  assert.equal(write.session, 3);
});

/** Gladys (re)connects while getConfig fails `failures` times (the SDK's connect reads it once itself). */
async function reconnectFailing(ctx, failures) {
  const original = ctx.gladys.getConfig.bind(ctx.gladys);
  const state = { failures };
  ctx.gladys.getConfig = async () => {
    if (state.failures > 0) {
      state.failures -= 1;
      throw new Error('503');
    }
    return original();
  };
  ctx.gladys.fake.config = { ism8_address: '192.168.1.62' };
  ctx.app.gladysConnected();
  await ctx.advance(100);
  return state;
}

test('getConfig failing in "connected": retried without end, then the start goes on', async (t) => {
  const ctx = await setup(t);
  const state = await reconnectFailing(ctx, 3);
  assert.match(status(ctx.gladys).message.en, /could not be read from Gladys \(attempt 1\)/);
  await ctx.advance(60 * SECOND);
  assert.equal(state.failures, 0);
  assert.equal(startCalls(ctx.gladys).at(-1).env.ISM8_ADDRESS, '192.168.1.62');
  assert.doesNotMatch(status(ctx.gladys).message.en, /could not be read/);
});

test('a stop while getConfig fails still leaves', async (t) => {
  const ctx = await setup(t);
  await reconnectFailing(ctx, Infinity);
  ctx.channel().up({ id: 1, from: ISM8_IP });
  await ctx.advance(100);
  await ctx.command('direct-circuit', 57, 'standby');
  assert.equal(ctx.channel().writes(57).length, 1);
});

test('a stop contradicted before confirmation is sent again, 3 times at most', async (t) => {
  const ctx = await setup(t);
  await ctx.ism8Up();
  await ctx.command('direct-circuit', 57, 'standby', { wait: 100 });
  for (let i = 0; i < 5; i += 1) {
    await ctx.advance(6 * SECOND);
    await ctx.values([[57, byte(0)]]);
  }
  assert.equal(ctx.channel().writes(57).length, 3);
  assert.match(status(ctx.gladys).message.en, /sent 3 times without confirmation/);
});

test('a confirmed stop is lifted by a value read twice in a row elsewhere, never by time', async (t) => {
  const ctx = await setup(t);
  await ctx.ism8Up();
  await ctx.command('direct-circuit', 57, 'standby', { wait: 100 });
  await ctx.values([[57, byte(2)]]);
  assert.equal(ctx.store.data.stops['57'].confirmed, true);
  await ctx.advance(30 * 24 * 60 * MINUTE);
  assert.ok(ctx.store.data.stops['57'], 'never lifted by time');
  await ctx.values([[57, byte(1)]]);
  assert.ok(ctx.app.memory.stops.has(57), 'one read is not enough');
  await ctx.values([[57, byte(2)]]);
  await ctx.values([[57, byte(1)]]);
  assert.ok(ctx.app.memory.stops.has(57), 'not twice in a row');
  await ctx.values([[57, byte(1)]]);
  assert.equal(ctx.app.memory.stops.has(57), false);
  assert.equal(ctx.channel().writes(57).length, 1, 'a confirmed stop is never fought');
});

test('a stop is lifted by a click on another program (writes allowed), saved before the bytes leave', async (t) => {
  const ctx = await ready(t);
  await ctx.command('direct-circuit', 57, 'standby', { wait: 100 });
  echo(ctx);
  const ack = await ctx.command('direct-circuit', 57, 'auto');
  assert.equal(ack.success, true);
  assert.equal(ctx.store.data.stops['57'], undefined);
});

test('lifting a stop needs /data: a failed save refuses the click and keeps the stop', async (t) => {
  const ctx = await ready(t);
  await ctx.command('direct-circuit', 57, 'standby', { wait: 100 });
  ctx.store.failing = true;
  const ack = await ctx.command('direct-circuit', 57, 'auto', { wait: 100 });
  assert.equal(ack.success, false);
  assert.ok(ctx.app.memory.stops.has(57));
  assert.equal(ctx.channel().writes(57).length, 1);
});

test('a failed /data save never holds the stop', async (t) => {
  const store = memoryStore(null, { failing: true });
  const ctx = await setup(t, { store });
  await ctx.ism8Up();
  await ctx.command('direct-circuit', 57, 'standby', { wait: 100 });
  assert.equal(ctx.channel().writes(57).length, 1);
});

test('while a stop of the circuit is not confirmed, a setpoint is refused', async (t) => {
  const ctx = await ready(t);
  await ctx.command('direct-circuit', 58, 'standby', { wait: 100 });
  const ack = await ctx.command('direct-circuit', 56, 55, { wait: 100 });
  assert.equal(ack.success, false);
  assert.match(ack.error, /stop of this circuit/);
});

test('nothing emitted before a stop leaves after it: a write still deciding is dropped', async (t) => {
  const ctx = await ready(t);
  // The save before a lifted guard is the await that lets a stop pass first.
  await ctx.command('direct-circuit', 57, 'standby', { wait: 100 });
  await ctx.values([[57, byte(2)]]);
  let release;
  const save = ctx.store.save.bind(ctx.store);
  ctx.store.save = (data) => new Promise((resolve) => (release = () => resolve(save(data))));
  const target = { external_id: feature('direct-circuit', 57) };
  const pending = ctx.gladys.fake.setValue(
    { external_id: device('direct-circuit') },
    target,
    'comfort',
  );
  await ctx.advance(10);
  ctx.store.save = save;
  const stop = ctx.gladys.fake.setValue(
    { external_id: device('direct-circuit') },
    target,
    'standby',
  );
  await ctx.advance(10);
  release();
  await ctx.advance(4000);
  const [comfortAck] = await Promise.all([pending, stop]);
  assert.equal(comfortAck.success, false);
  const sent = ctx
    .channel()
    .writes(57)
    .map((w) => w.hex);
  assert.deepEqual(sent, ['02', '02']);
});

test('/data unreadable: never overwritten, the stop still leaves', async (t) => {
  const store = memoryStore({ token: 'b'.repeat(43) }, { unreadable: true });
  const ctx = await setup(t, { store });
  await ctx.ism8Up();
  await ctx.command('direct-circuit', 57, 'standby', { wait: 100 });
  assert.equal(ctx.channel().writes(57).length, 1);
  assert.equal(store.saves, 0);
  assert.match(status(ctx.gladys).message.en, /cannot be read/);
});

test('configurations saved back to back apply one by one, the last one winning', async (t) => {
  const ctx = await setup(t);
  await Promise.all([
    ctx.gladys.fake.configUpdated({ ...CONFIG, language: 'en' }),
    ctx.gladys.fake.configUpdated({ ...CONFIG, check_source: false }),
    ctx.gladys.fake.configUpdated({ ism8_address: '192.168.1.61' }),
  ]);
  await ctx.advance(100);
  assert.equal(ctx.app.config.host, '192.168.1.61');
  assert.equal(startCalls(ctx.gladys).at(-1).env.ISM8_ADDRESS, '192.168.1.61');
});

test('the refresh button: asks every value, at most every 30 s', async (t) => {
  const ctx = await setup(t);
  let ack = await ctx.gladys.fake.action('refresh');
  assert.match(ack.data.message.en, /not connected/);
  await ctx.ism8Up();
  const before = ctx.channel().readAlls();
  ack = await ctx.gladys.fake.action('refresh');
  assert.match(ack.data.message.en, /Asked the ISM8i/);
  ack = await ctx.gladys.fake.action('refresh');
  assert.match(ack.data.message.en, /try again/);
  assert.equal(ctx.channel().readAlls(), before + 1);
});

test('a full read every 5 minutes while the session lasts', async (t) => {
  const ctx = await setup(t);
  await ctx.ism8Up();
  const before = ctx.channel().readAlls();
  await ctx.advance(16 * MINUTE);
  assert.equal(ctx.channel().readAlls() - before, 3);
});

test('a refused connection is shown in the status (address only)', async (t) => {
  const ctx = await setup(t);
  ctx.channel().up(null);
  ctx.channel().emit('message', { type: 'refused', from: '192.168.1.99', count: 2, at: ctx.at() });
  await ctx.advance(100);
  assert.match(status(ctx.gladys).message.en, /2 connection\(s\) refused from 192\.168\.1\.99/);
});

test('Gladys reconnects: nothing old republished, a fresh full read asked', async (t) => {
  const ctx = await setup(t);
  await ctx.ism8Up();
  await ctx.values([[4, temp(60)]]);
  await ctx.advance(2 * SECOND);
  const published = ctx.gladys.fake.states.length;
  const reads = ctx.channel().readAlls();
  await ctx.advance(40 * SECOND);
  await ctx.app.gladysConnected();
  await ctx.advance(2 * SECOND);
  assert.equal(ctx.gladys.fake.states.length, published);
  assert.equal(ctx.channel().readAlls(), reads + 1);
});

// --- Checks that look doubled: each one is the only one on some path ------------------------

test('writes off is said on arrival, before anything else (ISM8 away, a stop running)', async (t) => {
  const ctx = await setup(t);
  const ack = await ctx.command('direct-circuit', 56, 55);
  assert.match(ack.error, /writes are off/);
});

test('a setpoint above the ceiling is refused on arrival, whatever the session', async (t) => {
  const ctx = await setup(t, { config: { ...WRITES, dhw_max_temperature: 55 } });
  const ack = await ctx.command('direct-circuit', 56, 60);
  assert.match(ack.error, /ceiling of 55/);
});

test('a value of another session is never fresh', async (t) => {
  const ctx = await ready(t);
  const entry = ctx.app.values.get(56);
  assert.equal(ctx.app.freshValue(56), 50);
  ctx.app.values.set(56, { ...entry, session: entry.session + 1 });
  assert.equal(ctx.app.freshValue(56), undefined);
  ctx.app.values.set(56, { ...entry, mono: ctx.clock.monotonic() - 16 * MINUTE });
  assert.equal(ctx.app.freshValue(56), undefined, 'too old');
});

test('a confirmed stop is not sent again at the next session', async (t) => {
  const ctx = await setup(t);
  await ctx.ism8Up(1);
  await ctx.command('direct-circuit', 57, 'standby');
  await ctx.values([[57, byte(2)]]);
  assert.equal(ctx.store.data.stops['57'].confirmed, true);
  await ctx.ism8Up(2);
  assert.equal(ctx.channel().writes(57).length, 1);
});

test('a click that lifts a stop but cannot leave puts the stop back', async (t) => {
  const ctx = await ready(t);
  await ctx.command('direct-circuit', 57, 'standby');
  ctx.channel().send = () => false;
  const ack = await ctx.command('direct-circuit', 57, 'comfort');
  assert.equal(ack.success, false);
  assert.ok(ctx.app.memory.stops.has(57));
  assert.ok(ctx.store.data.stops['57']);
});

test('a click that could not leave within 2.5 s is not sent (slow /data), the stop kept', async (t) => {
  const ctx = await ready(t);
  await ctx.command('direct-circuit', 57, 'standby');
  const save = ctx.store.save.bind(ctx.store);
  ctx.store.save = (data) =>
    new Promise((resolve) => ctx.clock.timers.setTimeout(() => resolve(save(data)), 3000));
  const ack = await ctx.command('direct-circuit', 57, 'comfort');
  ctx.store.save = save;
  assert.equal(ack.success, false);
  assert.match(ack.error, /not sent in time/);
  assert.equal(ctx.channel().writes(57).length, 1);
  assert.ok(ctx.app.memory.stops.has(57));
});

test('a value that waited more than a minute for Gladys is dropped, never published late', async (t) => {
  const ctx = await setup(t);
  await ctx.ism8Up();
  const publish = ctx.gladys.publishChangedStates.bind(ctx.gladys);
  ctx.gladys.publishChangedStates = async () => {
    throw new Error('Gladys away');
  };
  await ctx.values([[4, temp(66)]]);
  await ctx.advance(70 * SECOND);
  ctx.gladys.publishChangedStates = publish;
  await ctx.advance(3 * SECOND);
  assert.equal(ctx.gladys.fake.lastState(feature('appliance-1', 4)), undefined);
});

test('one command at a time per setting: a second one while the first waits is refused', async (t) => {
  const ctx = await ready(t);
  const target = { external_id: feature('direct-circuit', 56) };
  const first = ctx.gladys.fake.setValue({ external_id: device('direct-circuit') }, target, 55);
  await ctx.advance(10);
  const second = await ctx.command('direct-circuit', 56, 52);
  assert.match(second.error, /still running/);
  await ctx.advance(4000);
  await first;
  assert.equal(ctx.channel().writes(56).length, 1);
});

test('a stop the link did not write does not use one of its 3 attempts', async (t) => {
  const ctx = await setup(t);
  await ctx.ism8Up();
  ctx.channel().answer = () => ({ sent: false, reason: 'session' });
  await ctx.command('direct-circuit', 57, 'standby');
  assert.equal(ctx.store.data.stops['57'].attempts, 0);
});

test('never more than 250 states a minute to Gladys', async (t) => {
  const ctx = await setup(t);
  await ctx.ism8Up();
  const ids = [...(await import('../src/ism8/datapoints.js')).DATAPOINTS.values()]
    .filter((dp) => dp.kind === 'temperature')
    .map((dp) => dp.id);
  const before = ctx.gladys.fake.states.length;
  // ~80 temperatures changing every second for 6 s: ~480 states wanted.
  for (let round = 0; round < 6; round += 1) {
    await ctx.values(ids.map((id) => [id, temp(20 + round)]));
    await ctx.advance(1100);
  }
  await ctx.advance(30 * SECOND);
  assert.ok(ids.length * 6 > 300);
  assert.ok(
    ctx.gladys.fake.states.length - before <= 250,
    `${ctx.gladys.fake.states.length - before}`,
  );
});

test('a scene on 5 settings at once: the 5 leave, none holds another', async (t) => {
  const ctx = await ready(t);
  await ctx.values([
    [69, temp(50)],
    [82, temp(50)],
    [95, temp(50)],
    [70, byte(0)],
  ]);
  echo(ctx, { delay: 800 });
  const targets = [
    ['direct-circuit', 56, 55],
    ['mixer-circuit-1', 69, 54],
    ['mixer-circuit-2', 82, 53],
    ['mixer-circuit-3', 95, 52],
    ['mixer-circuit-1', 70, 'eco'],
  ];
  const acks = targets.map(([slug, id, value]) => {
    const target = { external_id: feature(slug, id) };
    return ctx.gladys.fake.setValue({ external_id: device(slug) }, target, value);
  });
  await ctx.advance(4000);
  const results = await Promise.all(acks);
  assert.deepEqual(
    results.map((r) => r.data),
    targets.map(() => ({ confirmed: true })),
  );
  assert.equal(ctx.channel().writes().length, 5);
});

test('the channel secret never reaches the logs nor the status', async (t) => {
  const ctx = await ready(t);
  await ctx.command('direct-circuit', 57, 'standby');
  const token = ctx.store.data.token;
  assert.ok(token.length >= 32);
  assert.ok(!ctx.logs.some((line) => line.includes(token)));
  assert.ok(!JSON.stringify(ctx.gladys.fake.connectionStatuses).includes(token));
  assert.ok(!JSON.stringify(ctx.gladys.fake.discoveredDevices).includes(token));
});
