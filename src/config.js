// -----------------------------------------------------------------------------
// The configuration: the manifest `config_schema` values, normalized so the
// rest of the code never deals with strings typed in a form. Nothing here is
// a secret (the ISM8 protocol has no password); the secret of the channel
// between the two containers lives in /data (src/store.js).
// -----------------------------------------------------------------------------

import { isIP } from 'node:net';
import { DHW_CAP } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULT_CONFIG = {
  ism8_address: '',
  check_source: true,
  allow_writes: false,
  dhw_max_temperature: DHW_CAP.default,
  language: 'fr',
};

/** Only `true` (or the text "true") allows: anything else, missing included, refuses. */
const strictTrue = (value) => value === true || value === 'true';
/** Only `false` (or the text "false") turns off: a missing value keeps the safe default. */
const strictFalse = (value) => value === false || value === 'false';

/** "::ffff:192.168.1.5" -> "192.168.1.5"; an IPv6 in lower case; undefined if not an IP. */
export function normalizeIp(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  let text = value.trim();
  if (/^::ffff:\d{1,3}(\.\d{1,3}){3}$/i.test(text)) {
    text = text.slice(7);
  }
  const version = isIP(text);
  if (version === 4) {
    return text;
  }
  return version === 6 ? text.toLowerCase() : undefined;
}

/**
 * The address of the ISM8: one IP address of a machine (no name: the address
 * the connection comes from is compared to it; neither 0.0.0.0, ::, a
 * multicast nor the broadcast address).
 * @returns {{ host: string } | { error: 'empty' | 'invalid' }}
 */
export function parseIsm8Address(raw) {
  const text = typeof raw === 'string' ? raw.trim().replace(/^\[(.*)\]$/, '$1') : '';
  if (text === '') {
    return { error: 'empty' };
  }
  const ip = text.length <= 64 ? normalizeIp(text) : undefined;
  if (
    !ip ||
    ip === '0.0.0.0' ||
    ip === '::' ||
    ip === '255.255.255.255' ||
    /^(22[4-9]|2[3-5]\d)\./.test(ip) ||
    /^ff/i.test(ip)
  ) {
    return { error: 'invalid' };
  }
  return { host: ip };
}

/**
 * The hot water ceiling: a whole number of °C between DHW_CAP.min and
 * DHW_CAP.max, rounded down; anything that is not a number gives the
 * default (65 °C); never above 65 °C.
 */
export function parseDhwCap(raw) {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DHW_CAP.default;
  }
  return Math.min(DHW_CAP.max, Math.max(DHW_CAP.min, Math.floor(value)));
}

export function normalizeConfig(raw = {}) {
  const c = { ...DEFAULT_CONFIG };
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (Object.hasOwn(c, key) && value !== null && value !== undefined) {
      c[key] = value;
    }
  }
  const address = parseIsm8Address(c.ism8_address);
  return {
    /** Why the configuration cannot be used (shown in the status), else undefined. */
    problem: address.error ? `address:${address.error}` : undefined,
    host: address.host,
    checkSource: !strictFalse(c.check_source),
    allowWrites: strictTrue(c.allow_writes),
    dhwCap: parseDhwCap(c.dhw_max_temperature),
    language: c.language === 'en' ? 'en' : 'fr',
  };
}

/** The environment of the link: what it depends on (a change starts it again). */
export function linkEnv(config, token, { ism8Port, channelPort }) {
  return {
    CHANNEL_TOKEN: token,
    ISM8_PORT: String(ism8Port),
    CHANNEL_PORT: String(channelPort),
    ...(config.checkSource && config.host ? { ISM8_ADDRESS: config.host } : {}),
  };
}
