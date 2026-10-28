// -----------------------------------------------------------------------------
// The ISM8 frames (pure). Ported from wolf_ism8 (MIT, Marc Schmiedchen,
// `ism8.py` and `ism8_constants.py`, version 4.3), which follows the
// "ISM8 / ISM8i Schnittstellenbeschreibung" published by Wolf: KNXnet/IP
// framing carrying the "ObjectServer" services.
//
//   frame   = 06 20 F0 80 | size (2 bytes, the whole frame) | 04 00 00 00 | service...
//   from the ISM8, SetDatapointValue.Req:
//     F0 06 | start id (2) | count (2) | count x [ id (2) | command (1) | length (1) | value ]
//   our answer, SetDatapointValue.Res (17 bytes, the start id copied):
//     06 20 F0 80 00 11 04 00 00 00 F0 86 | start id (2) | 00 00 00
//   a write, DatapointValue.Ind (one datapoint):
//     06 20 F0 80 | size | 04 00 00 00 F0 C1 | id (2) | 00 01 | id (2) | 00 | length | value
//   "request all datapoints" (the ISM8 then sends every value again):
//     06 20 F0 80 00 16 04 00 00 00 F0 D0
//   12 bytes whose size field says 22: byte for byte what wolf_ism8 (on a
//   click) and the openHAB ISM8 binding (once, right after the ISM8
//   connected, then its acknowledgements) send. The openHAB binding has been
//   used with real ISM8 modules for years: an ISM8 waiting for 22 bytes would
//   swallow the 10 first bytes of its first acknowledgement every time. Kept as
//   is, and sent as seldom as they do (see src/app.js).
//
// Differences with wolf_ism8, on purpose: a frame is checked whole before
// anything is used (header, size, service, the datapoints filling the frame
// exactly); a datapoint of 0 or more than 4 bytes is skipped, never the
// connection (wolf_ism8 has such a frame in its tests, taken from the field);
// a byte stream that does not start with the header is refused instead of
// searched for the next header; frames are bounded (FRAME.max bytes,
// FRAME.maxItems datapoints). The command byte (0x03 for a value) is checked
// by the main container (src/app.js), which decodes.
// -----------------------------------------------------------------------------

export const HEADER = Buffer.from([0x06, 0x20, 0xf0, 0x80]);
export const CONNECTION_HEADER = Buffer.from([0x04, 0x00, 0x00, 0x00]);
export const SERVICE = Object.freeze({
  SET_REQ: 0x06,
  SET_RES: 0x86,
  VALUE_IND: 0xc1,
  REQUEST_ALL: 0xd0,
});

export const FRAME = Object.freeze({
  /** Header (4) + size (2) + connection header (4). */
  prefix: 10,
  /** The smallest SetDatapointValue.Req: prefix + F0 06 + start + count + one empty datapoint. */
  min: 20,
  /** The largest frame accepted (the ISM8 knows about 300 datapoints of 1 to 4 bytes). */
  max: 2048,
  maxItems: 300,
  maxValue: 4,
});

/** SetDatapointValue.Res for a frame whose start id is `start` (wolf_ism8 ISM_ACK_DP_MSG). */
export function ackFrame(start) {
  return Buffer.from([
    ...HEADER,
    0x00,
    0x11,
    ...CONNECTION_HEADER,
    0xf0,
    SERVICE.SET_RES,
    (start >> 8) & 0xff,
    start & 0xff,
    0x00,
    0x00,
    0x00,
  ]);
}

/** "Request all datapoints", byte for byte as wolf_ism8 sends it (ISM_REQ_DP_MSG). */
export const REQUEST_ALL = Buffer.from([
  ...HEADER,
  0x00,
  0x16,
  ...CONNECTION_HEADER,
  0xf0,
  SERVICE.REQUEST_ALL,
]);

/** A write of one datapoint (wolf_ism8 build_message); `value` 1 to 4 bytes. */
export function writeFrame(id, value) {
  if (!Number.isInteger(id) || id < 1 || id > 0xffff) {
    throw new RangeError('datapoint id out of range');
  }
  if (!Buffer.isBuffer(value) || value.length < 1 || value.length > FRAME.maxValue) {
    throw new RangeError('value of 1 to 4 bytes');
  }
  const body = Buffer.from([
    ...CONNECTION_HEADER,
    0xf0,
    SERVICE.VALUE_IND,
    id >> 8,
    id & 0xff,
    0x00,
    0x01,
    id >> 8,
    id & 0xff,
    0x00,
    value.length,
    ...value,
  ]);
  const size = HEADER.length + 2 + body.length;
  return Buffer.concat([HEADER, Buffer.from([size >> 8, size & 0xff]), body]);
}

/**
 * Parses one complete frame. Returns
 *   { service: 'values', start, items: [{ id, command, value: Buffer }] }
 *   { service: 'other', code }      (a valid frame of another service)
 *   or throws a FrameError (the connection is dropped).
 */
export function parseFrame(frame) {
  if (frame.length < FRAME.prefix + 2 || frame.length > FRAME.max) {
    throw new FrameError('size');
  }
  if (!frame.subarray(0, 4).equals(HEADER) || frame.readUInt16BE(4) !== frame.length) {
    throw new FrameError('header');
  }
  if (!frame.subarray(6, 10).equals(CONNECTION_HEADER) || frame[10] !== 0xf0) {
    throw new FrameError('header');
  }
  const code = frame[11];
  if (code !== SERVICE.SET_REQ) {
    return { service: 'other', code };
  }
  if (frame.length < FRAME.min) {
    throw new FrameError('size');
  }
  const start = frame.readUInt16BE(12);
  const count = frame.readUInt16BE(14);
  if (count < 1 || count > FRAME.maxItems) {
    throw new FrameError('count');
  }
  const items = [];
  let at = 16;
  for (let i = 0; i < count; i += 1) {
    if (at + 4 > frame.length) {
      throw new FrameError('truncated');
    }
    const id = frame.readUInt16BE(at);
    const command = frame[at + 2];
    const length = frame[at + 3];
    if (at + 4 + length > frame.length) {
      throw new FrameError('length');
    }
    // A datapoint without a value or longer than any known type: skipped, the frame kept.
    if (length >= 1 && length <= FRAME.maxValue) {
      items.push({ id, command, value: Buffer.from(frame.subarray(at + 4, at + 4 + length)) });
    }
    at += 4 + length;
  }
  if (at !== frame.length) {
    throw new FrameError('trailing');
  }
  return { service: 'values', start, items };
}

export class FrameError extends Error {
  constructor(reason) {
    super(`invalid ISM8 frame (${reason})`);
    this.reason = reason;
  }
}

/**
 * Cuts a byte stream into frames, bounded: never holds more than FRAME.max
 * bytes, refuses a stream that does not start with the header or announces a
 * size out of bounds (FrameError: the caller drops the connection). Linear:
 * a chunk is scanned once, the pending part (FRAME.max at most) copied once
 * per chunk.
 */
export class FrameReader {
  constructor() {
    this.pending = Buffer.alloc(0);
  }

  get buffered() {
    return this.pending.length;
  }

  /** Returns the complete frames found once `chunk` is added. */
  push(chunk) {
    let data = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    const frames = [];
    for (;;) {
      if (data.length === 0) break;
      const head = Math.min(data.length, 4);
      if (!data.subarray(0, head).equals(HEADER.subarray(0, head))) {
        this.pending = Buffer.alloc(0);
        throw new FrameError('header');
      }
      if (data.length < 6) break;
      const size = data.readUInt16BE(4);
      if (size < FRAME.prefix + 2 || size > FRAME.max) {
        this.pending = Buffer.alloc(0);
        throw new FrameError('size');
      }
      if (data.length < size) break;
      frames.push(Buffer.from(data.subarray(0, size)));
      data = data.subarray(size);
    }
    if (data.length > FRAME.max) {
      this.pending = Buffer.alloc(0);
      throw new FrameError('size');
    }
    this.pending = Buffer.from(data);
    return frames;
  }
}
