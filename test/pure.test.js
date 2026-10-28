// -----------------------------------------------------------------------------
// The pure parts: frames, datapoints, configuration, /data, the model.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig, parseDhwCap, parseIsm8Address } from '../src/config.js';
import { DHW_CAP } from '../src/constants.js';
import {
  COMMANDS,
  DATAPOINTS,
  SELECTABLE,
  STOP,
  decodeFloat,
  decodeValue,
  encodeCommand,
  encodeFloat,
} from '../src/ism8/datapoints.js';
import {
  FRAME,
  FrameError,
  FrameReader,
  REQUEST_ALL,
  ackFrame,
  parseFrame,
  writeFrame,
} from '../src/ism8/protocol.js';
import { TABLE } from '../src/ism8/table.js';
import { DP_NAMES, GROUP_NAMES, MODE_NAMES } from '../src/i18n.js';
import { buildDevices, parseFeatureId, statesOf } from '../src/model.js';
import { normalizeMemory, serializeMemory } from '../src/store.js';
import { byte, temp, valuesFrame } from './fixtures/ism8.js';

const CORE_NORMALIZE = '/home/claude/code/Gladys/server/utils/normalizeSupportedOptions.js';
const normalizeSupportedOptions = existsSync(CORE_NORMALIZE)
  ? createRequire(import.meta.url)(CORE_NORMALIZE).normalizeSupportedOptions
  : undefined;

test('frames: the ack, the write and "request all" byte for byte as wolf_ism8 builds them', () => {
  assert.equal(ackFrame(0x0138).toString('hex'), '0620f080001104000000f0860138000000');
  assert.equal(
    writeFrame(56, temp(55)).toString('hex'),
    `0620f080001604000000f0c1003800010038000${2}${temp(55).toString('hex')}`,
  );
  assert.deepEqual(
    [...writeFrame(57, byte(2))],
    [0x06, 0x20, 0xf0, 0x80, 0x00, 0x15, 4, 0, 0, 0, 0xf0, 0xc1, 0, 57, 0, 1, 0, 57, 0, 1, 2],
  );
  assert.equal(REQUEST_ALL.toString('hex'), '0620f080001604000000f0d0');
  assert.throws(() => writeFrame(0, byte(1)), RangeError);
  assert.throws(() => writeFrame(56, Buffer.alloc(5)), RangeError);
});

test('frames: parsed whole; anything malformed is refused', () => {
  const frame = valuesFrame([
    [4, temp(60)],
    [9, byte(1)],
  ]);
  const parsed = parseFrame(frame);
  assert.equal(parsed.service, 'values');
  assert.equal(parsed.start, 4);
  assert.deepEqual(
    parsed.items.map((i) => [i.id, i.command, i.value.toString('hex')]),
    [
      [4, 3, temp(60).toString('hex')],
      [9, 3, '01'],
    ],
  );
  const broken = [
    Buffer.concat([frame, Buffer.from([0])]), // size field wrong
    Buffer.from([...frame.subarray(0, 15), 3, ...frame.subarray(16)]), // count 3
    (() => {
      const copy = Buffer.from(frame);
      copy[19] = 9; // a length past the end
      return copy;
    })(),
    (() => {
      const copy = Buffer.from(frame);
      copy[0] = 0x07;
      return copy;
    })(),
  ];
  // A frame whose size covers a byte after the last datapoint.
  const trailing = Buffer.concat([frame, Buffer.from([0])]);
  trailing.writeUInt16BE(trailing.length, 4);
  broken.push(trailing);
  for (const bytes of broken) assert.throws(() => parseFrame(bytes), FrameError);
  assert.throws(() => parseFrame(trailing), /trailing/);
  // 301 datapoints: refused.
  const many = valuesFrame(Array.from({ length: 301 }, (_, i) => [1 + i, byte(0)]));
  assert.throws(() => parseFrame(many), /count/);
  // A datapoint of 5 bytes is skipped, the others kept.
  const five = parseFrame(
    valuesFrame([
      [4, temp(60)],
      [999, Buffer.alloc(5)],
      [9, byte(1)],
    ]),
  );
  assert.deepEqual(
    five.items.map((i) => i.id),
    [4, 9],
  );
  // Another service, valid: ignored, not refused.
  const other = Buffer.from(frame.subarray(0, 12));
  other[5] = 12;
  other[11] = 0x86;
  assert.deepEqual(parseFrame(other), { service: 'other', code: 0x86 });
});

test('the reader: frames glued or cut anywhere, bounded, garbage refused', () => {
  const a = valuesFrame([[4, temp(60)]]);
  const b = valuesFrame([[5, temp(40)]]);
  const all = Buffer.concat([a, b]);
  for (let cut = 0; cut <= all.length; cut += 1) {
    const reader = new FrameReader();
    const frames = [...reader.push(all.subarray(0, cut)), ...reader.push(all.subarray(cut))];
    assert.equal(frames.length, 2, `cut at ${cut}`);
    assert.equal(reader.buffered, 0);
  }
  assert.throws(() => new FrameReader().push(Buffer.from('hello')), FrameError);
  assert.throws(
    () => new FrameReader().push(Buffer.from([0x06, 0x20, 0xf0, 0x80, 0x10, 0x00])),
    FrameError,
  );
  assert.throws(
    () => new FrameReader().push(Buffer.from([0x06, 0x20, 0xf0, 0x80, 0x00, 0x05])),
    FrameError,
  );
  const reader = new FrameReader();
  reader.push(Buffer.from([0x06, 0x20, 0xf0, 0x80, (FRAME.max >> 8) & 0xff, FRAME.max & 0xff]));
  assert.ok(reader.buffered <= FRAME.max);
});

test('DPT 9: the KNX examples, invalid values, whole degrees exact both ways', () => {
  assert.equal(decodeFloat(Buffer.from([0x0c, 0x1a])), 21);
  assert.equal(decodeFloat(Buffer.from([0x8a, 0x24])), -30);
  assert.equal(decodeFloat(Buffer.from([0x00, 0x00])), 0);
  assert.equal(decodeFloat(Buffer.from([0x7f, 0xff])), undefined);
  assert.equal(decodeFloat(Buffer.from([0x07, 0xff])), undefined);
  assert.equal(decodeFloat(Buffer.from([0x0c])), undefined);
  for (let value = 20; value <= 65; value += 1) {
    assert.equal(decodeFloat(encodeFloat(value)), value, value);
  }
  assert.throws(() => encodeFloat(NaN), RangeError);
});

test('values: lengths, ranges, modes; a text is never a number', () => {
  const dp = (id) => DATAPOINTS.get(id);
  assert.equal(decodeValue(dp(4), temp(55)), 55);
  assert.equal(decodeValue(dp(4), byte(1)), undefined, 'wrong length');
  assert.equal(decodeValue(dp(4), temp(400)), undefined, 'implausible');
  assert.equal(decodeValue(dp(3), byte(255)), 100);
  assert.equal(decodeValue(dp(1), byte(3)), 1);
  assert.deepEqual(decodeValue(dp(57), byte(2)), { key: 'standby', code: 2 });
  assert.deepEqual(decodeValue(dp(57), byte(9)), { code: 9 });
  assert.deepEqual(decodeValue(dp(372), byte(0)), { code: 0 });
  // 0.01 x 1172 x 2^7 = 1500.16 kW
  assert.equal(
    decodeValue(dp(191), Buffer.from([(7 << 3) | (1172 >> 8), 1172 & 0xff])),
    undefined,
    'power over 1000 kW',
  );
  assert.deepEqual(statesOf(dp(372), { code: 0 }, 'en'), [['dp-372', { text: 'None' }]]);
  assert.deepEqual(statesOf(dp(2), { code: 6, key: 'standby' }, 'fr')[0][1], {
    text: 'Veille (arrêt, hors-gel)',
  });
  assert.deepEqual(statesOf(dp(57), { code: 99 }, 'en'), [
    ['dp-57-text', { text: 'Unknown code 99' }],
  ]);
});

test('the table: ids unique, every shown datapoint named in both languages, writes limited', () => {
  assert.equal(new Set(TABLE.map((row) => row[0])).size, TABLE.length);
  for (const dp of DATAPOINTS.values()) {
    assert.ok(DP_NAMES[dp.name]?.en && DP_NAMES[dp.name]?.fr, `${dp.id} ${dp.name}`);
    assert.ok(GROUP_NAMES[dp.slug], dp.slug);
  }
  assert.ok(!DATAPOINTS.has(767), 'the keep-alive is never shown');
  assert.ok(!DATAPOINTS.has(336), 'the undocumented block is left out');
  assert.deepEqual(
    Object.keys(COMMANDS)
      .map(Number)
      .sort((a, b) => a - b),
    [56, 57, 58, 69, 70, 71, 82, 83, 84, 95, 96, 97],
  );
  for (const id of Object.keys(COMMANDS)) {
    const row = TABLE.find((r) => r[0] === Number(id));
    assert.equal(row[4], true, `${id} is writable per Wolf`);
  }
  for (const [command, options] of Object.entries(SELECTABLE)) {
    assert.ok(Object.hasOwn(options, STOP[command]), `${command} offers its stop`);
    for (const key of Object.keys(options)) assert.ok(MODE_NAMES[key], key);
  }
  assert.equal(encodeCommand(DATAPOINTS.get(57), 'standby').toString('hex'), '02');
  assert.equal(encodeCommand(DATAPOINTS.get(58), 'standby').toString('hex'), '04');
  assert.throws(() => encodeCommand(DATAPOINTS.get(57), 'cooling'), RangeError);
});

test('configuration: the address, the ceiling, the strict booleans', () => {
  assert.deepEqual(parseIsm8Address(' 192.168.1.60 '), { host: '192.168.1.60' });
  assert.deepEqual(parseIsm8Address('[FD00::5]'), { host: 'fd00::5' });
  for (const bad of [
    'ism8',
    '192.168.1.60:12004',
    '0.0.0.0',
    '::',
    '239.1.1.1',
    'ff02::1',
    '255.255.255.255',
    'x'.repeat(80),
  ]) {
    assert.deepEqual(parseIsm8Address(bad), { error: 'invalid' }, bad);
  }
  assert.deepEqual(parseIsm8Address(''), { error: 'empty' });
  assert.equal(parseDhwCap(90), DHW_CAP.max);
  assert.equal(parseDhwCap(10), DHW_CAP.min);
  assert.equal(parseDhwCap('55.9'), 55);
  assert.equal(parseDhwCap('abc'), 65);
  assert.equal(parseDhwCap(null), 65);
  const config = normalizeConfig({
    ism8_address: '192.168.1.60',
    allow_writes: 'yes',
    check_source: 'no',
  });
  assert.equal(config.allowWrites, false, 'only true allows');
  assert.equal(config.checkSource, true, 'only false turns the check off');
  assert.equal(
    normalizeConfig({ gladys_x: 1, __proto__: { allow_writes: true } }).allowWrites,
    false,
  );
});

test('/data: only known keys of the right shape; a time in the future is replaced', () => {
  const now = 1_800_000_000_000;
  const memory = normalizeMemory(
    {
      token: 'f'.repeat(43),
      seen: [4, 999999, 'x', 57],
      stops: {
        57: { at: now + 10_000, attempts: 99, confirmed: 'yes' },
        4: { at: 1, attempts: 0 },
        __proto__: { at: 1 },
      },
      extra: 1,
    },
    now,
  );
  assert.deepEqual([...memory.seen], [4, 57]);
  assert.deepEqual([...memory.stops.keys()], [57]);
  assert.deepEqual(memory.stops.get(57), { at: now, attempts: 3, confirmed: false });
  assert.deepEqual(serializeMemory(memory), {
    token: 'f'.repeat(43),
    linkEnv: undefined,
    seen: [4, 57],
    stops: { 57: { at: now, attempts: 3, confirmed: false } },
  });
  assert.equal(normalizeMemory({ token: 'short' }, now).token, undefined);
});

test('the model: ids frozen, every supported option follows the rules of the core', () => {
  const gladys = createFakeGladys({});
  const seen = new Set(DATAPOINTS.keys());
  for (const language of ['fr', 'en']) {
    const devices = buildDevices(gladys, seen, { language });
    assert.equal(devices.length, new Set([...DATAPOINTS.values()].map((d) => d.slug)).size);
    for (const feature of devices.flatMap((d) => d.features)) {
      assert.match(
        feature.external_id,
        /^ext:test-integration:wolf-ism8:[a-z0-9-]+:dp-\d+(-text)?$/,
      );
      if (feature.type === 'binary') assert.equal(feature.read_only, true, feature.external_id);
      if (feature.category === 'water-heater') assert.ok(feature.max <= 65);
      if (!feature.supported_options) continue;
      const options = feature.supported_options;
      for (const option of options) {
        assert.deepEqual(Object.keys(option).sort(), ['label', 'sort_order', 'value']);
        assert.equal(typeof option.label, 'string');
        assert.equal(option.label, option.label.trim());
        assert.ok(option.label.length > 0);
        assert.equal(typeof option.value, 'string');
        assert.equal(option.value, option.value.trim());
        assert.ok(Number.isInteger(option.sort_order));
      }
      assert.equal(new Set(options.map((o) => o.value)).size, options.length);
      if (normalizeSupportedOptions) {
        assert.deepEqual(normalizeSupportedOptions(options, { allowStringValues: true }), options);
      }
    }
    const names = devices.flatMap((d) => d.features.map((f) => `${d.external_id}|${f.name}`));
    assert.equal(new Set(names).size, names.length, 'feature names unique per device');
  }
  assert.equal(parseFeatureId('ext:s:wolf-ism8:direct-circuit:dp-57').id, 57);
  assert.equal(parseFeatureId('ext:s:wolf-ism8:appliance-1:dp-57'), undefined, 'wrong device');
  assert.equal(parseFeatureId('ext:s:wolf-ism8:direct-circuit:dp-57-text'), undefined);
});

test('a created feature the new build lacks is kept', () => {
  const gladys = createFakeGladys({});
  const created = new Map([
    [
      'appliance-1',
      {
        features: [
          {
            external_id: 'ext:test-integration:wolf-ism8:appliance-1:dp-5',
            name: 'x',
            category: 'unknown',
            type: 'decimal',
            id: 'db',
          },
        ],
      },
    ],
  ]);
  const [device] = buildDevices(gladys, new Set([4]), { language: 'fr', created });
  assert.deepEqual(
    device.features.map((f) => f.external_id),
    [
      'ext:test-integration:wolf-ism8:appliance-1:dp-4',
      'ext:test-integration:wolf-ism8:appliance-1:dp-5',
    ],
  );
  assert.equal(device.features[1].id, undefined);
});
