// -----------------------------------------------------------------------------
// What each ISM8 datapoint means here (pure): its kind (how it is shown in
// Gladys), its decoding, the plausibility range of its values, and the few
// that can be written. Decoders ported from wolf_ism8 4.3 (MIT, Marc
// Schmiedchen, `ism8_helper_functions.py`).
//
// Kinds: temperature (°C), room temperature, temperature difference (K),
// percentage, pressure (Pa, KNX 9.006 as wolf_ism8 says), power (kW),
// flow (l/h), binary state, mode (a text), error code (a text). Not shown in
// this version: dates, times, energy counters, the ventilation air flows,
// the BM-2 detection bit fields and the keep-alive (767).
//
// A value that cannot be decoded, the "invalid" float (mantissa all ones),
// a length that does not match the type, or a number outside the
// plausibility range of its kind gives `undefined`: never published, never
// used by a decision.
// -----------------------------------------------------------------------------

import { TABLE } from './table.js';

/** wolf_ism8 HVACModes (KNX DPT 20.102 as Wolf names them): heating circuit program. */
export const HEATING_PROGRAMS = Object.freeze({
  0: 'auto',
  1: 'comfort',
  2: 'standby',
  3: 'eco',
  4: 'frost-protection',
  6: 'cooling',
  7: 'auto-heating',
  8: 'auto-cooling',
});
/** wolf_ism8 DHWModes: hot water program. */
export const DHW_PROGRAMS = Object.freeze({
  0: 'auto',
  1: 'legionella',
  2: 'continuous',
  3: 'reduced',
  4: 'standby',
});
/** wolf_ism8 HVACContrModes: operating state of an appliance (read only). */
export const OPERATING_STATES = Object.freeze({
  0: 'auto',
  1: 'heating',
  2: 'preheating',
  3: 'cooling',
  4: 'night-purge',
  5: 'precool',
  6: 'standby',
  7: 'test',
  8: 'emergency-heat',
  9: 'fan-only',
  10: 'free-cool',
  11: 'frost-protection',
  12: 'maximum-heating',
  13: 'economic',
  14: 'dehumidification',
  15: 'calibration',
  16: 'emergency-cool',
  17: 'emergency-steam',
  20: 'no-demand',
});
/** wolf_ism8 HVACModes_CWL: ventilation program (read only). */
export const VENTILATION_PROGRAMS = Object.freeze({
  0: 'auto',
  1: 'nominal',
  2: 'standby',
  3: 'reduced',
  4: 'humidity-protection',
});
/** wolf_ism8 HeatGenTypes: the appliance types the BM-2 reports (read only). */
export const APPLIANCE_TYPES = Object.freeze({
  0: 'none',
  1: 'CGB-2',
  2: 'MGK-2',
  3: 'TOB',
  4: 'BWL-1S',
  5: 'FGB',
  6: 'CHA',
  7: 'COB-2',
  8: 'CGB-2 38/55',
  9: 'CGB-2 38/55',
  10: 'TGB-2',
  11: 'TGB-2',
  12: 'CGB-2 75/100',
  13: 'CGB-2 75/100',
  14: 'FHA',
});

const ENUMS = {
  DPT_HVACMode: HEATING_PROGRAMS,
  DPT_DHWMode: DHW_PROGRAMS,
  DPT_HVACContrMode: OPERATING_STATES,
  DPT_HVACMode_CWL: VENTILATION_PROGRAMS,
  DPT_HeatGenType: APPLIANCE_TYPES,
};

/**
 * The writable datapoints of this version, and only them: the hot water
 * setpoint, the heating program and the hot water program of the direct
 * circuit and of the mixer circuits 1 to 3. Every other datapoint is read
 * only, whatever Wolf allows (boiler power and temperature presets, time
 * programs, the one-off hot water charge, ventilation...).
 */
export const COMMANDS = Object.freeze({
  56: 'dhw-setpoint',
  57: 'heating-program',
  58: 'dhw-program',
  69: 'dhw-setpoint',
  70: 'heating-program',
  71: 'dhw-program',
  82: 'dhw-setpoint',
  83: 'heating-program',
  84: 'dhw-program',
  95: 'dhw-setpoint',
  96: 'heating-program',
  97: 'dhw-program',
});

/** The program values offered in Gladys (the code written), standby being the stop. */
export const SELECTABLE = Object.freeze({
  'heating-program': Object.freeze({ auto: 0, comfort: 1, eco: 3, standby: 2 }),
  'dhw-program': Object.freeze({ auto: 0, continuous: 2, standby: 4 }),
});
/** The protective value of each program: always allowed, never held. */
export const STOP = Object.freeze({ 'heating-program': 'standby', 'dhw-program': 'standby' });

/** Hot water setpoint written: Wolf accepts 20-80 °C (wolf_ism8 DP_VALUES_ALLOWED), this module 20-65. */
export const DHW_SETPOINT = Object.freeze({ min: 20, max: 65 });

const RANGES = {
  temperature: [-60, 300],
  'room-temperature': [-60, 100],
  'temperature-difference': [-30, 30],
  percent: [0, 100],
  pressure: [0, 1_000_000],
  power: [-1000, 1000],
  flow: [0, 100_000],
};

const KIND_OF_TYPE = {
  DPT_Value_Temp: 'temperature',
  DPT_Tempd: 'temperature-difference',
  DPT_Value_Tempd: 'temperature-difference',
  DPT_Scaling: 'percent',
  DPT_Value_Pres: 'pressure',
  DPT_Power: 'power',
  DPT_Value_Volume_Flow: 'flow',
  DPT_Switch: 'binary',
  DPT_Bool: 'binary',
  DPT_Enable: 'binary',
  DPT_OpenClose: 'binary',
  DPT_HVACMode: 'mode',
  DPT_DHWMode: 'mode',
  DPT_HVACContrMode: 'mode',
  DPT_HVACMode_CWL: 'mode',
  DPT_HeatGenType: 'mode',
};

const LENGTH_OF_KIND = {
  temperature: 2,
  'room-temperature': 2,
  'temperature-difference': 2,
  pressure: 2,
  power: 2,
  flow: 2,
  percent: 1,
  binary: 1,
  mode: 1,
  code: 1,
};

/** The device slug of each Wolf device name: the stable part of the external ids. */
export const GROUPS = Object.freeze({
  Heizgeraet1: 'appliance-1',
  Heizgeraet2: 'appliance-2',
  Heizgeraet3: 'appliance-3',
  Heizgeraet4: 'appliance-4',
  Systembedienmodul: 'system',
  Direkter_Heizkreis_WW: 'direct-circuit',
  Mischerkreis1: 'mixer-circuit-1',
  Mischerkreis2: 'mixer-circuit-2',
  Mischerkreis3: 'mixer-circuit-3',
  Kaskadenmodul: 'cascade',
  Mischermodul1: 'mixer-module-1',
  Mischermodul2: 'mixer-module-2',
  Mischermodul3: 'mixer-module-3',
  Solarmodul: 'solar',
  CWL_Wohnraumlueftung: 'ventilation',
  Waermepumpe: 'heat-pump-1',
  Waermepumpe2: 'heat-pump-2',
  Waermepumpe3: 'heat-pump-3',
  Waermepumpe4: 'heat-pump-4',
  Bedienmodul_BM2: 'bm2',
});

/** The keep-alive of the ISM8: received, never shown. */
export const KEEPALIVE = 767;

function kindOf(id, name, type) {
  if (id === KEEPALIVE) return undefined;
  if (id === 372) return 'code';
  if (name === 'Raumtemperatur') return 'room-temperature';
  return KIND_OF_TYPE[type];
}

/** id -> { id, group, slug, name, type, kind, command } for every shown datapoint. */
export const DATAPOINTS = new Map(
  TABLE.map(([id, group, name, type]) => [
    id,
    Object.freeze({
      id,
      group,
      slug: GROUPS[group],
      name,
      type,
      kind: kindOf(id, name, type),
      command: COMMANDS[id],
    }),
  ]).filter(([, dp]) => dp.kind !== undefined && dp.slug !== undefined),
);

/** The code -> key list of a mode datapoint. */
export const enumOf = (dp) => ENUMS[dp.type];

/** KNX DPT 9 (2 bytes): 0.01 x mantissa x 2^exponent; mantissa all ones = invalid (wolf_ism8). */
export function decodeFloat(bytes) {
  if (bytes.length !== 2) return undefined;
  const raw = bytes.readUInt16BE(0);
  const sign = raw >> 15;
  const exponent = (raw >> 11) & 0x0f;
  let mantissa = raw & 0x07ff;
  if (mantissa === 0x07ff) return undefined;
  if (sign === 1) mantissa -= 2048;
  return Math.round(mantissa * 2 ** exponent) / 100;
}

/** The reverse, for a hot water setpoint: exact for whole degrees from 20 to 65. */
export function encodeFloat(value) {
  if (!Number.isFinite(value) || value < 0 || value > 600) {
    throw new RangeError('value out of range');
  }
  let mantissa = Math.round(value * 100);
  let exponent = 0;
  while (mantissa > 2047) {
    exponent += 1;
    mantissa = Math.round(Math.round(value * 100) / 2 ** exponent);
  }
  const raw = (exponent << 11) | mantissa;
  return Buffer.from([raw >> 8, raw & 0xff]);
}

/**
 * The value of a datapoint from its bytes: a number (measures, 0/1 for a
 * binary), `{ key }` / `{ code }` for a mode (a known program key, else its
 * code), `{ code }` for the error code; undefined when not usable.
 */
export function decodeValue(dp, bytes) {
  if (!dp || !Buffer.isBuffer(bytes) || bytes.length !== LENGTH_OF_KIND[dp.kind]) {
    return undefined;
  }
  switch (dp.kind) {
    case 'binary':
      return bytes[0] & 1;
    case 'mode': {
      const key = ENUMS[dp.type]?.[bytes[0]];
      return key === undefined ? { code: bytes[0] } : { key, code: bytes[0] };
    }
    case 'code':
      return { code: bytes[0] };
    case 'percent':
      return inRange(dp.kind, Math.round((bytes[0] * 1000) / 255) / 10);
    default:
      return inRange(dp.kind, decodeFloat(bytes));
  }
}

function inRange(kind, value) {
  const [min, max] = RANGES[kind];
  return Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}

/** The bytes of a value to write: a program key or a whole hot water setpoint. */
export function encodeCommand(dp, value) {
  if (dp.command === 'dhw-setpoint') {
    return encodeFloat(value);
  }
  const code = SELECTABLE[dp.command]?.[value];
  if (code === undefined) {
    throw new RangeError('unknown program');
  }
  return Buffer.from([code]);
}

/**
 * The last check before bytes leave for the ISM8 (in the link): a writable
 * datapoint of COMMANDS, a whole hot water setpoint from 20 to 65 °C, or a
 * program code offered here. Returns { ok, stop } (stop: the standby code).
 */
export function checkWrite(id, bytes) {
  const dp = DATAPOINTS.get(id);
  if (!dp?.command || !Buffer.isBuffer(bytes)) return { ok: false, stop: false };
  if (dp.command === 'dhw-setpoint') {
    const value = decodeFloat(bytes);
    const ok = Number.isInteger(value) && value >= DHW_SETPOINT.min && value <= DHW_SETPOINT.max;
    return { ok, stop: false };
  }
  if (bytes.length !== 1) return { ok: false, stop: false };
  const codes = SELECTABLE[dp.command];
  const ok = Object.values(codes).includes(bytes[0]);
  return { ok, stop: ok && bytes[0] === codes[STOP[dp.command]] };
}

/** Whether a decoded value is the one a command asked for. */
export function sameValue(dp, decoded, wanted) {
  if (decoded === undefined) return false;
  if (dp.command === 'dhw-setpoint') return decoded === wanted;
  return decoded?.key === wanted;
}

export const GROUP_OF = (slug) => Object.keys(GROUPS).find((group) => GROUPS[group] === slug);
