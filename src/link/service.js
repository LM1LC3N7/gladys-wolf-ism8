// -----------------------------------------------------------------------------
// The service of the `ism8-link` sub-container: the TCP port the ISM8i
// connects to (the ISM8 is the client: it opens the connection towards the
// address and port typed in its web page), and the channel that hands its
// values to the main container and takes the writes back. The main container
// cannot publish a port; this container does (Gladys picks the host port).
//
// Bounded for a 64 MB container:
//   - 4 open connections at most; a fifth is closed at once;
//   - when the sender is checked (ISM8_ADDRESS), a connection from any other
//     address is closed before a byte is read, and the main container is told
//     (at most every 10 s, the address only);
//   - one ISM8 session at a time: a new connection of the ISM8 replaces the
//     previous one (the ISM8 reconnects after a network cut while the old
//     socket may still look open), never two sessions side by side;
//   - frames of 2048 bytes and 300 datapoints at most, checked whole
//     (src/ism8/protocol.js); a stream that does not start with the ISM8
//     header, a size out of bounds or a malformed frame closes the
//     connection; a frame left incomplete for 5 s closes it too;
//   - 1000 frames per 10 s at most (a full dump of the ISM8 is about 300
//     frames, one datapoint each, as the field captures show); over that the
//     connection is closed;
//   - 20 writes per 10 s at most from the main container, and one "request
//     all" per 30 s; a stop (the standby program, `stop: true`) is never
//     counted nor refused by these limits, only without an ISM8 session;
//   - the last check before the bytes leave: only the writable datapoints of
//     src/ism8/datapoints.js, a hot water setpoint of 20 to 65 °C, a program
//     code offered by the integration (checkWrite).
//
// Every valid SetDatapointValue.Req is acknowledged at once, as wolf_ism8
// does (the ISM8 repeats a frame left unacknowledged), and its datapoints are
// handed over as hex, undecoded: decoding is the main container's job.
//
// Environment, set by the main container through startContainer:
//   CHANNEL_TOKEN  the secret the main container says hello with
//   ISM8_PORT      12004 (published by Gladys on a host port of its choice)
//   CHANNEL_PORT   7779 (private network only)
//   ISM8_ADDRESS   the IP address of the ISM8, when the sender is checked
// -----------------------------------------------------------------------------

import { createServer } from 'node:net';
import { performance } from 'node:perf_hooks';
import { createChannelServer } from '../channel.js';
import { normalizeIp } from '../config.js';
import { LINK, LIMITS } from '../constants.js';
import {
  FrameError,
  FrameReader,
  REQUEST_ALL,
  parseFrame,
  ackFrame,
  writeFrame,
} from '../ism8/protocol.js';
import { checkWrite } from '../ism8/datapoints.js';

const HEX = /^(?:[0-9a-f]{2}){1,4}$/;

/**
 * @returns {Promise<{ server, channel, stop(): Promise, port: number, session(): object|undefined }>}
 */
export async function startLinkService({
  env = process.env,
  logger,
  now = Date.now,
  clock = () => performance.now(),
  timers = globalThis,
} = {}) {
  const expected = env.ISM8_ADDRESS ? normalizeIp(env.ISM8_ADDRESS) : null;
  if (env.ISM8_ADDRESS && !expected) {
    logger?.warn('ISM8_ADDRESS is not an IP address: every connection is refused');
  }
  const checked = Boolean(env.ISM8_ADDRESS);
  const sockets = new Set();
  let session;
  let sessions = 0;
  let lastRefusedNotice = -Infinity;
  let refusedSince = 0;
  const writes = [];
  let lastReadAll = -Infinity;

  const at = () => new Date(now()).toISOString();

  const channel = createChannelServer({
    port: Number(env.CHANNEL_PORT ?? LINK.channelPort),
    token: env.CHANNEL_TOKEN,
    logger,
    queueSize: LIMITS.linkQueue,
    hello: () => ({
      session: session ? { id: session.id, from: session.from, since: session.since } : null,
    }),
    onMessage: (message) => onMainMessage(message),
  });

  function onMainMessage(message) {
    const seq = message?.seq;
    if (!Number.isSafeInteger(seq) || seq < 0) return;
    const answer = (fields) => channel.send({ type: 'result', seq, ...fields }, { queue: false });
    if (message.type !== 'write' && message.type !== 'readAll') {
      answer({ sent: false, reason: 'unknown' });
      return;
    }
    let frame;
    let stop = false;
    if (message.type === 'readAll') {
      frame = REQUEST_ALL;
    } else {
      const { id, hex } = message;
      const bytes = typeof hex === 'string' && HEX.test(hex) ? Buffer.from(hex, 'hex') : undefined;
      const check = Number.isInteger(id) ? checkWrite(id, bytes) : { ok: false };
      // A message saying "stop" must really be a standby program.
      if (!check.ok || (message.stop === true && !check.stop)) {
        answer({ sent: false, reason: 'invalid' });
        return;
      }
      stop = message.stop === true;
      frame = writeFrame(id, bytes);
    }
    const mono = clock();
    if (!stop) {
      while (writes.length > 0 && mono - writes[0] >= LIMITS.linkWritesWindow) writes.shift();
      const readAllTooSoon =
        message.type === 'readAll' && mono - lastReadAll < LIMITS.linkReadAllSpacing;
      if (writes.length >= LIMITS.linkWrites || readAllTooSoon) {
        answer({ sent: false, reason: 'rate' });
        return;
      }
    }
    if (!session || message.session !== session.id || session.socket.destroyed) {
      answer({ sent: false, reason: 'session' });
      return;
    }
    if (!stop) writes.push(mono);
    if (message.type === 'readAll') lastReadAll = mono;
    // Handed to the kernel: from here the bytes may have left.
    session.socket.write(frame);
    answer({ sent: true, at: at() });
  }

  function notifyRefused(from) {
    refusedSince += 1;
    const mono = clock();
    if (mono - lastRefusedNotice >= LIMITS.refusedNoticeEvery) {
      lastRefusedNotice = mono;
      channel.send({ type: 'refused', from, count: refusedSince, at: at() });
      refusedSince = 0;
    }
  }

  function endSession(current, reason) {
    if (session !== current) return;
    session = undefined;
    timers.clearTimeout(current.stallTimer);
    channel.send({ type: 'session', state: 'down', session: current.id, reason, at: at() });
  }

  function onConnection(socket) {
    socket.on('error', () => {});
    if (sockets.size >= LIMITS.linkSockets) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const from = normalizeIp(socket.remoteAddress);
    if (checked && (!expected || from !== expected)) {
      socket.destroy();
      notifyRefused(from ?? 'unknown');
      return;
    }
    if (session) {
      // The ISM8 came back: the previous socket is closed, never kept beside.
      const previous = session;
      endSession(previous, 'replaced');
      previous.socket.destroy();
    }
    sessions += 1;
    const current = {
      id: sessions,
      from: from ?? 'unknown',
      since: at(),
      socket,
      reader: new FrameReader(),
      frames: [],
      stallTimer: undefined,
    };
    session = current;
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 60_000);
    logger?.info(`ISM8 connected from ${current.from} (session ${current.id})`);
    channel.send({
      type: 'session',
      state: 'up',
      session: current.id,
      from: current.from,
      at: current.since,
    });

    const drop = (reason) => {
      logger?.warn(`ISM8 connection closed: ${reason}`);
      endSession(current, reason);
      socket.destroy();
    };

    socket.on('data', (chunk) => {
      if (session !== current) {
        socket.destroy();
        return;
      }
      let frames;
      try {
        frames = current.reader.push(chunk);
      } catch (err) {
        drop(err instanceof FrameError ? err.message : 'invalid data');
        return;
      }
      const mono = clock();
      for (const frame of frames) {
        while (current.frames.length > 0 && mono - current.frames[0] >= LIMITS.framesWindow) {
          current.frames.shift();
        }
        current.frames.push(mono);
        if (current.frames.length > LIMITS.frames) {
          drop('too many frames');
          return;
        }
        let parsed;
        try {
          parsed = parseFrame(frame);
        } catch (err) {
          drop(err instanceof FrameError ? err.message : 'invalid frame');
          return;
        }
        if (parsed.service !== 'values') continue;
        socket.write(ackFrame(parsed.start));
        if (parsed.items.length === 0) continue;
        channel.send({
          type: 'values',
          session: current.id,
          at: at(),
          items: parsed.items.map(({ id, command, value }) => [id, command, value.toString('hex')]),
        });
      }
      timers.clearTimeout(current.stallTimer);
      current.stallTimer = undefined;
      if (current.reader.buffered > 0) {
        current.stallTimer = timers.setTimeout(() => drop('incomplete frame'), LIMITS.frameStall);
      }
    });
    socket.on('close', () => {
      timers.clearTimeout(current.stallTimer);
      if (session === current) {
        logger?.info(`ISM8 disconnected (session ${current.id})`);
        endSession(current, 'closed');
      }
    });
  }

  await channel.start();
  const server = createServer(onConnection);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(Number(env.ISM8_PORT ?? LINK.ism8Port), '0.0.0.0', () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (err) {
    await channel.stop();
    throw err;
  }
  logger?.info(
    `Waiting for the ISM8 on port ${server.address().port}${checked ? ` (from ${expected ?? 'nobody'} only)` : ''}`,
  );

  return {
    server,
    channel,
    get port() {
      return server.address()?.port;
    },
    session: () => session,
    stop() {
      for (const socket of sockets) socket.destroy();
      return Promise.all([
        new Promise((resolve) => server.close(() => resolve())),
        channel.stop(),
      ]).then(() => undefined);
    },
  };
}
