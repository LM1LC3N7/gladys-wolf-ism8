// -----------------------------------------------------------------------------
// The datapoints of the ISM8 -> Gladys devices, features and states (pure).
//
// One ISM8 per integration. The ISM8 protocol carries no serial number: one
// Gladys device per Wolf device the ISM8 reports (heating appliance 1, direct
// circuit, mixer circuit 2, heat pump...), external id
// `ext:<selector>:wolf-ism8:<slug>` (slugs of src/ism8/datapoints.js), and
// one feature per datapoint, `<device>:dp-<id>` (the Wolf datapoint number).
// Frozen: renaming one orphans the device or the feature and its history.
//
// A device appears once one of its datapoints gave a value; a feature once
// its datapoint did. A device published again never loses a feature: those
// of the device created in Gladys are kept as they are.
//
// No switch, no writable binary: a "turn everything off" of a voice
// assistant or a scene must never reach the boiler. The writable features
// are the hot water setpoints (`water-heater/target-temperature`, capped at
// 65 °C) and the heating and hot water programs (`text/select`, standby
// being the stop), refused unless the configuration allows writes
// (src/app.js), standby excepted.
//
// Units only from the core's DEVICE_FEATURE_UNITS_BY_CATEGORY: °C, kW, Pa
// (the system pressure, as the reference). The percentages, the temperature
// differences and the flows are `unknown/decimal`, the unit in the name.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { DEVICE_TYPE } from './constants.js';
import { DATAPOINTS, DHW_SETPOINT, GROUP_OF, SELECTABLE } from './ism8/datapoints.js';
import {
  DEVICE_PREFIX,
  DP_NAMES,
  GROUP_NAMES,
  MODE_NAMES,
  faultCodeText,
  modeText,
  word,
} from './i18n.js';

const sensor = (definition) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...definition,
});
const text = () =>
  sensor({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false });
const decimal = (min, max) => sensor({ category: C.UNKNOWN, type: T.SENSOR.DECIMAL, min, max });

/** The feature of a datapoint, without its name and id. */
export function definitionOf(dp) {
  if (dp.command === 'dhw-setpoint') {
    return {
      category: C.WATER_HEATER,
      type: T.WATER_HEATER.TARGET_TEMPERATURE,
      unit: U.CELSIUS,
      // The slider stops at the hard ceiling; the configured one refuses below it.
      min: DHW_SETPOINT.min,
      max: DHW_SETPOINT.max,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    };
  }
  if (dp.command) {
    return {
      category: C.TEXT,
      type: T.TEXT.SELECT,
      min: 0,
      max: 0,
      read_only: false,
      has_feedback: true,
      keep_history: false,
    };
  }
  switch (dp.kind) {
    case 'temperature':
      return sensor({
        category: C.TEMPERATURE_SENSOR,
        type: T.TEMPERATURE_SENSOR.PROBE,
        unit: U.CELSIUS,
        min: -60,
        max: 300,
      });
    case 'room-temperature':
      return sensor({
        category: C.TEMPERATURE_SENSOR,
        type: T.SENSOR.DECIMAL,
        unit: U.CELSIUS,
        min: -60,
        max: 100,
      });
    case 'power':
      return sensor({
        category: C.ENERGY_SENSOR,
        type: T.ENERGY_SENSOR.POWER,
        unit: U.KILOWATT,
        min: -1000,
        max: 1000,
      });
    case 'pressure':
      // DPT_Value_Pres: pascal, as KNX 9.006, wolf_ism8 and Home Assistant say.
      return sensor({
        category: C.PRESSURE_SENSOR,
        type: T.SENSOR.DECIMAL,
        unit: U.PASCAL,
        min: 0,
        max: 1_000_000,
      });
    case 'binary':
      return sensor({ category: C.UNKNOWN, type: T.SENSOR.BINARY, min: 0, max: 1 });
    case 'mode':
    case 'code':
      return text();
    case 'percent':
      return decimal(0, 100);
    case 'temperature-difference':
      return decimal(-30, 30);
    case 'flow':
      return decimal(0, 100_000);
    default:
      return decimal(0, 1_000_000);
  }
}

/** The program options of a writable program datapoint, in the user's language. */
export function programOptions(dp, language) {
  return Object.keys(SELECTABLE[dp.command]).map((key, index) => ({
    value: key,
    label: word(MODE_NAMES[key], language),
    sort_order: index,
  }));
}

/** The fields of a feature Gladys stores (what is kept of a created feature). */
const DECLARED = [
  'name',
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'read_only',
  'has_feedback',
  'keep_history',
  'supported_options',
];

export const deviceIds = (gladys, slug) => gladys.externalIds(DEVICE_TYPE, slug);
export const featureKey = (id) => `dp-${id}`;
/** The read-only text twin of a program select: shows every program, those not offered too. */
export const readKey = (id) => `dp-${id}-text`;
export const isProgram = (dp) => Boolean(dp.command) && dp.command !== 'dhw-setpoint';
const READ_SUFFIX = Object.freeze({ en: 'read', fr: 'lu' });

/** The datapoint of one of our feature external ids, else undefined. */
export function parseFeatureId(externalId) {
  const match = /:wolf-ism8:([a-z0-9-]+):dp-(\d{1,5})$/.exec(String(externalId ?? ''));
  if (!match) return undefined;
  const dp = DATAPOINTS.get(Number(match[2]));
  return dp && dp.slug === match[1] ? dp : undefined;
}

/** The slug of one of our device external ids, else undefined. */
export function parseDeviceId(externalId) {
  const match = /:wolf-ism8:([a-z0-9-]+)$/.exec(String(externalId ?? ''));
  return match && GROUP_OF(match[1]) ? match[1] : undefined;
}

export const featureName = (dp, language) =>
  DP_NAMES[dp.name] ? word(DP_NAMES[dp.name], language) : dp.name;

/**
 * The Gladys devices of the datapoints seen. `created`: slug -> the device
 * created in Gladys, whose features are kept when the new build lacks them.
 */
export function buildDevices(gladys, seen, { language, created = new Map() }) {
  const bySlug = new Map();
  for (const id of [...seen].sort((a, b) => a - b)) {
    const dp = DATAPOINTS.get(id);
    if (!dp) continue;
    if (!bySlug.has(dp.slug)) bySlug.set(dp.slug, []);
    bySlug.get(dp.slug).push(dp);
  }
  const devices = [];
  for (const [slug, dps] of bySlug) {
    const ids = deviceIds(gladys, slug);
    const built = {
      name: `${DEVICE_PREFIX} ${word(GROUP_NAMES[slug], language)}`,
      external_id: ids.device,
      model: 'Wolf ISM8',
      should_poll: false,
      features: dps.flatMap((dp) => {
        const feature = {
          name: featureName(dp, language),
          external_id: ids.feature(featureKey(dp.id)),
          ...definitionOf(dp),
        };
        if (!isProgram(dp)) return [feature];
        return [
          { ...feature, supported_options: programOptions(dp, language) },
          {
            name: `${featureName(dp, language)} (${word(READ_SUFFIX, language)})`,
            external_id: ids.feature(readKey(dp.id)),
            ...text(),
          },
        ];
      }),
      params: [{ name: 'WOLF_DEVICE', value: dps[0].group }],
    };
    devices.push(keepCreatedFeatures(built, created.get(slug)));
  }
  return devices;
}

/** The features of the created device that the new build lacks, kept as they are. */
export function keepCreatedFeatures(built, created) {
  if (!created) {
    return built;
  }
  const have = new Set(built.features.map((f) => f.external_id));
  const kept = (created.features ?? [])
    .filter((f) => typeof f?.external_id === 'string' && !have.has(f.external_id))
    .map((f) =>
      Object.fromEntries(
        DECLARED.filter((k) => f[k] !== undefined && f[k] !== null).map((k) => [k, f[k]]),
      ),
    );
  return { ...built, features: [...built.features, ...kept] };
}

/**
 * The states of a datapoint value: [key, { state } | { text }] pairs. A
 * program gives its select (only when the value is one of the options: the
 * select keeps its last value otherwise) and its read-only text twin.
 */
export function statesOf(dp, value, language) {
  if (value === undefined) return [];
  if (isProgram(dp)) {
    const states = [[readKey(dp.id), { text: modeText(value, language) }]];
    if (value.key !== undefined && Object.hasOwn(SELECTABLE[dp.command], value.key)) {
      states.unshift([featureKey(dp.id), { text: value.key }]);
    }
    return states;
  }
  if (dp.kind === 'mode') return [[featureKey(dp.id), { text: modeText(value, language) }]];
  if (dp.kind === 'code')
    return [[featureKey(dp.id), { text: faultCodeText(value.code, language) }]];
  return Number.isFinite(value) ? [[featureKey(dp.id), { state: value }]] : [];
}
