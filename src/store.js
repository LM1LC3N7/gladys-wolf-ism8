// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container), in ism8.json, readable by the container user only (0600):
//
//   token   the secret of the channel between this container and the
//           `ism8-link` sub-container (random, generated here, given to the
//           link in its environment). Not a user secret: it only proves to
//           each side that the other one is ours. Kept here, not in the
//           Gladys configuration, so that a stop kept below can leave at
//           start-up before the configuration is read.
//   seen    the ids of the datapoints the ISM8 reported (the Discovery is
//           rebuilt from them at start-up)
//   stops   the stops (standby programs) asked and not lifted:
//           { "<datapoint id>": { at, attempts, confirmed } } — `at` the wall
//           time of the click (a time in the future is replaced by now),
//           `attempts` how many times it was sent (3 at most), `confirmed`
//           whether a value read afterwards showed it.
//
// Read back bounded, only known keys of the expected shape (never an
// inherited or `__proto__` key).
// -----------------------------------------------------------------------------

import { readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { DATAPOINTS, STOP } from './ism8/datapoints.js';
import { LIMITS } from './constants.js';

export const STATE_FILE = '/data/ism8.json';

const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
export const isToken = (value) => typeof value === 'string' && TOKEN.test(value);
export const newToken = () => randomBytes(32).toString('base64url');

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    /** null when there is no file yet; throws when it exists but cannot be read. */
    async load() {
      let text;
      try {
        text = await readFile(path, 'utf8');
      } catch (err) {
        if (err?.code === 'ENOENT') {
          return null;
        }
        throw err;
      }
      if (text.length > 16_384) {
        throw Object.assign(new Error('Too large'), { code: 'ETOOBIG' });
      }
      return JSON.parse(text);
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        await writeFile(temporary, text, { mode: 0o600 });
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

/** For the tests: the same JSON round trip as the file; `failing` refuses every save. */
export function memoryStore(initial = null, { failing = false, unreadable = false } = {}) {
  return {
    data: initial === null ? null : JSON.parse(JSON.stringify(initial)),
    saves: 0,
    failing,
    unreadable,
    async load() {
      if (this.unreadable) {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      }
      return this.data === null ? null : JSON.parse(JSON.stringify(this.data));
    },
    async save(data) {
      if (this.failing) {
        throw new Error('EROFS');
      }
      this.data = JSON.parse(JSON.stringify(data));
      this.saves += 1;
    },
  };
}

export const emptyMemory = () => ({ token: undefined, seen: new Set(), stops: new Map() });

/** A datapoint id whose stop may be kept: a program with a standby. */
const stoppable = (id) => STOP[DATAPOINTS.get(id)?.command] !== undefined;

/** From the file (any shape) to the memory; `now` replaces a time in the future. */
export function normalizeMemory(raw, now) {
  const memory = emptyMemory();
  if (!isObject(raw)) {
    return memory;
  }
  if (Object.hasOwn(raw, 'token') && isToken(raw.token)) {
    memory.token = raw.token;
  }
  if (Object.hasOwn(raw, 'seen') && Array.isArray(raw.seen)) {
    for (const id of raw.seen.slice(0, 400)) {
      if (Number.isInteger(id) && DATAPOINTS.has(id)) memory.seen.add(id);
    }
  }
  if (Object.hasOwn(raw, 'stops') && isObject(raw.stops)) {
    for (const key of Object.keys(raw.stops).slice(0, 20)) {
      const id = /^\d{1,5}$/.test(key) ? Number(key) : NaN;
      const stop = raw.stops[key];
      if (!stoppable(id) || !isObject(stop)) continue;
      const at = Number.isFinite(stop.at) && stop.at > 0 && stop.at <= now ? stop.at : now;
      const attempts =
        Number.isInteger(stop.attempts) && stop.attempts >= 0
          ? Math.min(stop.attempts, LIMITS.stopAttempts)
          : 0;
      memory.stops.set(id, { at, attempts, confirmed: stop.confirmed === true });
    }
  }
  return memory;
}

export function serializeMemory(memory) {
  return {
    token: memory.token,
    seen: [...memory.seen].sort((a, b) => a - b),
    stops: Object.fromEntries(
      [...memory.stops].map(([id, { at, attempts, confirmed }]) => [
        String(id),
        { at, attempts, confirmed },
      ]),
    ),
  };
}
