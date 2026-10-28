// -----------------------------------------------------------------------------
// The integration: one Wolf ISM8i, which connects by itself to the
// `ism8-link` sub-container (the main container cannot publish a port) and
// pushes the datapoints of the heating system; the link hands them over
// through the private channel (src/channel.js).
//
//   - Nothing listens before the configuration: the link is started only once
//     a valid ISM8 address is saved, stopped when it is removed.
//   - Values: decoded here (src/ism8/datapoints.js), published within the
//     Gladys rate limit, never when older than a minute (kept by the link
//     while this container was away); a full read at every new ISM8
//     session, every 5 minutes and after a command.
//   - Writes, off by default (`allow_writes`): hot water setpoint (20 °C to
//     the ceiling, 65 °C at most), heating and hot water programs. Decided on
//     the value the ISM8 sent in its current session, the option checked on
//     arrival and again right before the bytes leave, confirmed only by a
//     value read back after the write; otherwise "sent, without confirmation"
//     and follow-up reads.
//   - The stop (the standby program of a heating circuit or of the hot water)
//     is never held: no option, no bound, no read, no busy setting, no
//     pending configuration. Kept in /data (`stops`) and sent again (3 times
//     at most) at every new ISM8 session and when a read contradicts it
//     before it was confirmed; at start-up a kept stop leaves as soon as the
//     link answers, before the Gladys configuration is read. It is lifted
//     only by a user click on another program (allowed writes, the bytes
//     gone) or by a value read twice in a row elsewhere after confirmation,
//     never by time.
//
// Clocks: `clock` (monotonic) for every delay, deadline and freshness;
// `now` (wall) only to date what /data keeps and to compare with the time
// the link stamped on a message.
// -----------------------------------------------------------------------------

import { performance } from 'node:perf_hooks';
import { createLogger } from '@gladysassistant/integration-sdk';
import { ChannelClient } from './channel.js';
import { linkEnv, normalizeConfig } from './config.js';
import { DHW_CAP, LIMITS, LINK, TIMINGS } from './constants.js';
import {
  DATAPOINTS,
  DHW_SETPOINT,
  SELECTABLE,
  STOP,
  decodeValue,
  encodeCommand,
  sameValue,
} from './ism8/datapoints.js';
import { COMMAND, REFRESH, STATUS } from './i18n.js';
import { buildDevices, deviceIds, parseDeviceId, parseFeatureId, statesOf } from './model.js';
import { StatePublisher } from './publisher.js';
import {
  emptyMemory,
  fileStore,
  isToken,
  newToken,
  normalizeMemory,
  serializeMemory,
} from './store.js';

const HEX = /^(?:[0-9a-f]{2}){1,4}$/;
/** The ISM8 command byte of a value it reports (wolf_ism8: only 0x03 carries a value). */
const VALUE_COMMAND = 0x03;

/** A refusal: nothing was sent. */
class Refusal extends Error {
  constructor(why) {
    super(`Not sent: ${why.en}`);
    this.why = why;
  }
}

export class Ism8App {
  constructor({
    gladys,
    logger = createLogger({ name: 'wolf-ism8' }),
    store = fileStore(),
    now = Date.now,
    clock = () => performance.now(),
    timers = globalThis,
    createChannel = (options) => new ChannelClient(options),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.store = store;
    this.now = now;
    this.clock = clock;
    this.timers = timers;
    this.createChannel = createChannel;
    this.config = normalizeConfig();
    this.configRead = false;
    this.memory = emptyMemory();
    this.unreadable = false;
    this.booted = undefined;
    this.stopped = false;
    this.generation = 0;
    this.connectEpoch = 0;
    this.configChain = Promise.resolve();
    this.link = { status: 'not started', port: null, error: undefined, lastTry: -Infinity };
    this.linkStopped = false;
    this.channel = undefined;
    this.session = undefined;
    this.values = new Map();
    this.refused = undefined;
    this.running = new Map();
    this.stopEpochs = new Map();
    this.stopState = new Map();
    this.seq = 0;
    this.results = new Map();
    this.echoWaiters = new Set();
    this.lastReadAll = -Infinity;
    this.lastButton = -Infinity;
    this.followUps = new Set();
    this.lastCommand = undefined;
    this.lastStatus = undefined;
    this.publishedDevices = undefined;
    this.created = new Map();
    this.tickTimer = undefined;
    this.timersById = {};
    this.publisher = new StatePublisher({ gladys, logger, now: clock, timers });
  }

  // --- Start and stop -------------------------------------------------------------

  /** At start-up, before Gladys: /data, the channel (a kept stop may leave), the rounds. */
  boot() {
    if (!this.booted) {
      this.booted = this.doBoot();
    }
    return this.booted;
  }

  async doBoot() {
    let raw = null;
    try {
      raw = await this.store.load();
    } catch (err) {
      // A file that exists but cannot be read is not "nothing kept": it is never overwritten.
      this.unreadable = true;
      this.logger.error(`/data/ism8.json cannot be read (${err?.code ?? 'invalid'})`);
    }
    this.memory = normalizeMemory(raw, this.now());
    if (!isToken(this.memory.token)) {
      this.memory.token = newToken();
      await this.saveMemory();
    }
    this.publisher.start();
    this.tickTimer = this.timers.setInterval(() => {
      this.tick().catch((err) => this.logger.warn(`Background round failed: ${err.message}`));
    }, TIMINGS.tick);
    // The link may run from before this restart: a kept stop leaves as soon as it answers.
    this.startChannel();
  }

  stop() {
    this.stopped = true;
    this.generation += 1;
    this.connectEpoch += 1;
    this.timers.clearInterval(this.tickTimer);
    for (const id of Object.values(this.timersById)) this.timers.clearTimeout(id);
    for (const id of this.followUps) this.timers.clearTimeout(id);
    this.followUps.clear();
    this.timersById = {};
    this.publisher.stop();
    this.channel?.stop();
    this.channel = undefined;
    for (const resolve of this.results.values()) resolve(undefined);
    this.results.clear();
    for (const waiter of this.echoWaiters) waiter.resolve(false);
    this.echoWaiters.clear();
    return this.saveMemory().then(() => undefined);
  }

  later(name, delay, fn) {
    this.timers.clearTimeout(this.timersById[name]);
    const generation = this.generation;
    this.timersById[name] = this.timers.setTimeout(() => {
      this.timersById[name] = undefined;
      if (generation === this.generation && !this.stopped) {
        Promise.resolve()
          .then(fn)
          .catch((err) => this.logger.warn(`${name} failed: ${err.message}`));
      }
    }, delay);
  }

  /** Resolves true once written; never over a file that could not be read. */
  async saveMemory() {
    if (this.unreadable) return false;
    try {
      await this.store.save(serializeMemory(this.memory));
      return true;
    } catch (err) {
      this.logger.warn(`Saving /data/ism8.json failed: ${err.message}`);
      return false;
    }
  }

  // --- Gladys ---------------------------------------------------------------------------

  /**
   * Gladys (re)connected: the configuration is read, retried without end
   * (5 s, 10 s, 30 s, 1 min, then every 2 min) while it fails; then the
   * status and the Discovery again. Nothing old is published as new: a full
   * read of the ISM8 brings fresh values.
   */
  async gladysConnected() {
    await this.boot();
    const epoch = ++this.connectEpoch;
    this.lastStatus = undefined;
    this.publishedDevices = undefined;
    this.gladys.forgetPublishedStates?.();
    // What waited for Gladys is no longer the state: the full read below brings it again.
    this.publisher.clear();
    for (let attempt = 1; !this.stopped && epoch === this.connectEpoch; attempt += 1) {
      let raw;
      try {
        raw = await this.gladys.getConfig();
      } catch (err) {
        if (epoch !== this.connectEpoch || this.stopped) return;
        this.logger.warn(`Reading the configuration failed (attempt ${attempt}): ${err.message}`);
        await this.setStatus(false, STATUS.configUnread(attempt)).catch(() => {});
        const delays = TIMINGS.configRetry;
        await new Promise((resolve) => {
          this.later('configRetry', delays[Math.min(attempt - 1, delays.length - 1)], resolve);
        });
        continue;
      }
      if (epoch !== this.connectEpoch || this.stopped) return;
      this.refreshCreated();
      await this.configUpdated(raw);
      if (epoch !== this.connectEpoch || this.stopped) return;
      this.readAll('connected');
      return;
    }
  }

  /** Saved by the user: applied one after the other, the last one winning. */
  configUpdated(raw) {
    const run = this.configChain.then(() => this.applyConfig(raw));
    this.configChain = run.catch((err) =>
      this.logger.error(`Configuration failed: ${err.message}`),
    );
    return run;
  }

  async applyConfig(raw) {
    await this.boot();
    if (this.stopped) return;
    const before = this.config;
    this.config = normalizeConfig(raw);
    this.configRead = true;
    if (this.config.problem) {
      // Nothing listens without a valid address of the ISM8, not even a link
      // left running from before this start (cleared while it was stopped).
      if (!this.linkStopped) {
        await this.stopLink();
        this.linkStopped = true;
      }
    } else {
      this.linkStopped = false;
      await this.ensureLink();
    }
    if (before.language !== this.config.language) {
      this.publishedDevices = undefined;
    }
    await this.publishDiscovery();
    await this.updateStatus();
  }

  refreshCreated() {
    this.created.clear();
    for (const device of this.gladys.devices ?? []) {
      const slug = parseDeviceId(device?.external_id);
      if (slug) this.created.set(slug, device);
    }
  }

  /** A device created, updated or deleted: kept for its features; fresh values asked. */
  async deviceChanged() {
    this.refreshCreated();
    this.publishedDevices = undefined;
    await this.publishDiscovery();
    this.readAll('device');
  }

  async scan() {
    this.publishedDevices = undefined;
    await this.publishDiscovery();
  }

  async publishDiscovery() {
    const devices = buildDevices(this.gladys, this.memory.seen, {
      language: this.config.language,
      created: this.created,
    });
    const text = JSON.stringify(devices);
    if (text === this.publishedDevices) return;
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.publishedDevices = text;
    } catch (err) {
      this.logger.warn(`Publishing the Discovery failed: ${err.message}`);
    }
  }

  async setStatus(connected, text) {
    const message = {
      en: text.en.slice(0, LIMITS.status),
      fr: text.fr.slice(0, LIMITS.status),
    };
    const key = JSON.stringify([connected, message]);
    if (key === this.lastStatus) return;
    await this.gladys.setConnectionStatus(connected, message);
    this.lastStatus = key;
  }

  /** The status from what is known now; sent only when it changed. */
  async updateStatus() {
    if (!this.configRead || this.stopped) return;
    const generation = this.generation;
    let connected = false;
    let text;
    if (this.config.problem === 'address:empty') {
      text = STATUS.noAddress;
    } else if (this.config.problem) {
      text = STATUS.badAddress;
    } else if (this.link.status !== 'running') {
      text = STATUS.linkDown(this.link.error ?? this.link.status);
    } else if (!this.channel?.connected) {
      text = STATUS.linkUnreachable;
    } else if (!this.session) {
      text = STATUS.waiting(this.link.port, this.config.host);
    } else {
      connected = true;
      text = STATUS.connected(this.session.from, this.values.size);
    }
    const extras = [];
    if (this.refused) extras.push(STATUS.refused(this.refused.from, this.refused.count));
    if (!this.config.allowWrites) extras.push(STATUS.writesOff);
    const stops = [...this.memory.stops.values()];
    const waiting = stops.filter((s) => !s.confirmed && s.attempts < LIMITS.stopAttempts).length;
    const exhausted = stops.filter((s) => !s.confirmed && s.attempts >= LIMITS.stopAttempts).length;
    if (waiting > 0 && !this.session) extras.push(STATUS.stopsPending(waiting));
    if (exhausted > 0) extras.push(STATUS.stopsUnconfirmed(exhausted));
    if (this.unreadable) extras.push(STATUS.dataUnreadable);
    if (this.lastCommand) extras.push(STATUS.lastCommand(this.lastCommand));
    const message = {
      en: [text.en, ...extras.map((e) => e.en)].join(''),
      fr: [text.fr, ...extras.map((e) => e.fr)].join(''),
    };
    if (generation !== this.generation) return;
    await this.setStatus(connected, message).catch((err) =>
      this.logger.warn(`Publishing the status failed: ${err.message}`),
    );
  }

  // --- The link (sub-container) ------------------------------------------------------------

  async ensureLink() {
    this.link.lastTry = this.clock();
    const generation = this.generation;
    try {
      const env = linkEnv(this.config, this.memory.token, LINK);
      await this.gladys.startContainer(LINK.name, { env });
      const containers = await this.gladys.getContainers();
      if (generation !== this.generation) return;
      const container = (containers ?? []).find((c) => c?.name === LINK.name);
      const port = container?.ports?.find((p) => p?.name === LINK.portName)?.host_port;
      this.link = {
        ...this.link,
        status: typeof container?.status === 'string' ? container.status.slice(0, 40) : 'unknown',
        port: Number.isInteger(port) && port > 0 && port < 65536 ? port : null,
        error: undefined,
      };
    } catch (err) {
      if (generation !== this.generation) return;
      this.link = { ...this.link, status: 'error', error: String(err.message).slice(0, 120) };
      this.logger.warn(`Could not start the ISM8 link: ${err.message}`);
    }
    this.startChannel();
    // Started (again): the channel tries at once, not at the end of its backoff.
    this.channel?.retryNow?.();
  }

  async stopLink() {
    try {
      await this.gladys.stopContainer(LINK.name);
    } catch (err) {
      this.logger.debug(`Stopping the ISM8 link: ${err.message}`);
    }
    this.link = { ...this.link, status: 'not started', port: null, error: undefined };
    this.setSession(undefined);
  }

  startChannel() {
    if (this.channel || this.stopped || !isToken(this.memory.token)) return;
    const generation = this.generation;
    const channel = this.createChannel({
      host: LINK.name,
      port: LINK.channelPort,
      token: this.memory.token,
      logger: this.logger,
    });
    this.channel = channel;
    channel.on('up', (info) => {
      if (generation !== this.generation) return;
      this.logger.info('Connected to the ISM8 link');
      const current = info?.session;
      this.setSession(
        current && Number.isSafeInteger(current.id)
          ? { id: current.id, from: current.from }
          : undefined,
      );
      this.updateStatus();
    });
    channel.on('down', () => {
      if (generation !== this.generation) return;
      this.logger.warn('Lost the ISM8 link, reconnecting');
      // Whatever was asked and not answered may have left: "sent, without confirmation".
      for (const resolve of this.results.values()) resolve(undefined);
      this.results.clear();
      this.setSession(undefined);
      this.updateStatus();
    });
    channel.on('message', (message) => {
      if (generation !== this.generation) return;
      try {
        this.onLinkMessage(message);
      } catch (err) {
        this.logger.warn(`Message of the ISM8 link ignored: ${err.message}`);
      }
    });
    channel.start();
  }

  /** A new ISM8 session (or none): what was read before is unknown again. */
  setSession(session) {
    const before = this.session;
    if (before?.id === session?.id) return;
    this.session = session
      ? { id: session.id, from: String(session.from ?? '').slice(0, 64) }
      : undefined;
    this.values.clear();
    for (const state of this.stopState.values()) state.contra = 0;
    if (this.session) {
      this.refused = undefined;
      this.logger.info(`ISM8 session ${this.session.id} from ${this.session.from}`);
      this.sendPendingStops('session');
      this.readAll('session', { force: true });
    }
  }

  onLinkMessage(message) {
    switch (message?.type) {
      case 'session':
        if (message.state === 'up' && Number.isSafeInteger(message.session)) {
          this.setSession({ id: message.session, from: message.from });
        } else if (message.state === 'down' && message.session === this.session?.id) {
          this.setSession(undefined);
        }
        this.updateStatus();
        return;
      case 'refused':
        this.refused = {
          from: typeof message.from === 'string' ? message.from.slice(0, 64) : 'unknown',
          count:
            (this.refused?.count ?? 0) + (Number.isSafeInteger(message.count) ? message.count : 1),
        };
        this.updateStatus();
        return;
      case 'result': {
        const resolve = this.results.get(message.seq);
        if (resolve) {
          this.results.delete(message.seq);
          resolve(message);
        }
        return;
      }
      case 'values':
        this.onValues(message);
        return;
      default:
    }
  }

  // --- Values -------------------------------------------------------------------------------

  onValues(message) {
    if (!this.session || message.session !== this.session.id) return;
    const sent = Date.parse(message.at);
    // One reading of each clock for the whole message.
    const mono = this.clock();
    if (!Number.isFinite(sent) || Math.abs(this.now() - sent) > TIMINGS.valueMaxAge) {
      // Kept by the link while this container was away: no longer the state.
      return;
    }
    if (!Array.isArray(message.items)) return;
    const first = this.values.size === 0;
    let newSeen = false;
    for (const item of message.items.slice(0, LIMITS.itemsPerMessage)) {
      if (!Array.isArray(item) || item.length !== 3) continue;
      const [id, command, hex] = item;
      const dp = Number.isInteger(id) ? DATAPOINTS.get(id) : undefined;
      if (!dp || command !== VALUE_COMMAND || typeof hex !== 'string' || !HEX.test(hex)) continue;
      const value = decodeValue(dp, Buffer.from(hex, 'hex'));
      if (value === undefined) continue;
      this.values.set(id, { value, mono, session: this.session.id });
      if (!this.memory.seen.has(id)) {
        this.memory.seen.add(id);
        newSeen = true;
      }
      const ids = deviceIds(this.gladys, dp.slug);
      for (const [key, state] of statesOf(dp, value, this.config.language)) {
        this.publisher.push(ids.feature(key), state);
      }
      this.checkStop(dp, value, mono);
      for (const waiter of this.echoWaiters) {
        if (waiter.id === id && mono >= waiter.after) waiter.check(value);
      }
    }
    if (newSeen) {
      this.saveMemory();
      this.publishDiscovery();
    }
    if (first && this.values.size > 0) {
      // The first values of the session: the status says so now, not at the next round.
      this.updateStatus();
    }
  }

  /** The value of a datapoint read in the current session, recently enough; else undefined. */
  freshValue(id, mono = this.clock()) {
    const entry = this.values.get(id);
    if (!entry || !this.session || entry.session !== this.session.id) return undefined;
    return mono - entry.mono <= TIMINGS.valueFresh ? entry.value : undefined;
  }

  /** Asks the ISM8 for every value (at most once per 30 s unless forced). */
  readAll(why, { force = false } = {}) {
    const mono = this.clock();
    if (!this.session || !this.channel?.connected) return false;
    if (!force && mono - this.lastReadAll < TIMINGS.refreshButton) return false;
    this.lastReadAll = mono;
    this.logger.debug(`Reading every value (${why})`);
    return this.channel.send({ type: 'readAll', seq: ++this.seq, session: this.session.id });
  }

  async refreshButton() {
    await this.boot();
    const mono = this.clock();
    if (!this.session || !this.channel?.connected) return REFRESH.noSession;
    const wait = this.lastButton + TIMINGS.refreshButton - mono;
    if (wait > 0) return REFRESH.tooSoon(Math.ceil(wait / 1000));
    this.lastButton = mono;
    this.readAll('button', { force: true });
    return REFRESH.sent;
  }

  async tick() {
    if (this.stopped) return;
    const mono = this.clock();
    if (
      this.configRead &&
      !this.config.problem &&
      (this.link.status !== 'running' || !this.channel?.connected) &&
      mono - this.link.lastTry >= TIMINGS.linkRetry
    ) {
      await this.ensureLink();
    } else if (!this.channel?.connected) {
      // A link started a moment ago (its status read too early): tried now
      // rather than at the end of the backoff.
      this.channel?.retryNow?.();
    }
    if (this.session && mono - this.lastReadAll >= TIMINGS.refresh) {
      this.readAll('refresh', { force: true });
    }
    await this.updateStatus();
  }

  // --- Stops (protective, never held) ------------------------------------------------------

  stateOfStop(id) {
    if (!this.stopState.has(id)) this.stopState.set(id, { lastSent: -Infinity, contra: 0 });
    return this.stopState.get(id);
  }

  /** Sends one kept stop now if the ISM8 is connected; counts the attempt. */
  sendStop(id, why) {
    const stop = this.memory.stops.get(id);
    const dp = DATAPOINTS.get(id);
    if (!stop || !dp || !this.session || !this.channel?.connected) return undefined;
    const seq = ++this.seq;
    const hex = encodeCommand(dp, STOP[dp.command]).toString('hex');
    const sent = this.channel.send({ type: 'write', seq, session: this.session.id, id, hex });
    if (!sent) return undefined;
    stop.attempts = Math.min(LIMITS.stopAttempts, stop.attempts + 1);
    // An attempt the link did not write (another ISM8 session, its rate) does not count.
    this.results.set(seq, (answer) => {
      if (answer?.sent === false && this.memory.stops.get(id) === stop && stop.attempts > 0) {
        stop.attempts -= 1;
        this.saveMemory();
      }
    });
    this.stateOfStop(id).lastSent = this.clock();
    this.logger.info(`Stop of datapoint ${id} sent (${why}, attempt ${stop.attempts})`);
    this.saveMemory();
    this.followUp();
    return seq;
  }

  sendPendingStops(why) {
    for (const [id, stop] of this.memory.stops) {
      if (!stop.confirmed && stop.attempts < LIMITS.stopAttempts) this.sendStop(id, why);
    }
  }

  /** A value of a datapoint under a stop: confirms it, has it sent again, or lifts it. */
  checkStop(dp, value, mono) {
    const stop = this.memory.stops.get(dp.id);
    if (!stop) return;
    const state = this.stateOfStop(dp.id);
    if (sameValue(dp, value, STOP[dp.command])) {
      state.contra = 0;
      if (!stop.confirmed) {
        stop.confirmed = true;
        this.saveMemory();
        this.updateStatus();
      }
      return;
    }
    if (!stop.confirmed) {
      // Not applied yet (or the ISM8 reported the old value first): sent again, spaced, 3 times at most.
      if (
        stop.attempts < LIMITS.stopAttempts &&
        mono - state.lastSent >= TIMINGS.stopResendSpacing
      ) {
        this.sendStop(dp.id, 'contradicted');
      }
      return;
    }
    // Confirmed, then another program read: changed elsewhere (the boiler, the
    // Wolf app) once read twice in a row; never fought.
    state.contra += 1;
    if (state.contra >= 2) {
      this.memory.stops.delete(dp.id);
      this.stopState.delete(dp.id);
      this.logger.info(`Stop of datapoint ${dp.id} lifted: changed elsewhere, read twice`);
      this.saveMemory();
      this.updateStatus();
    } else {
      this.later(`contra-${dp.id}`, TIMINGS.echoRead, () =>
        this.readAll('stop check', { force: true }),
      );
    }
  }

  followUp() {
    for (const delay of TIMINGS.followUps) {
      const id = this.timers.setTimeout(() => {
        this.followUps.delete(id);
        if (!this.stopped) this.readAll('follow-up', { force: true });
      }, delay);
      this.followUps.add(id);
    }
  }

  // --- Commands -------------------------------------------------------------------------------

  /** Waits for a value of `id` read after `after` that is `wanted`, until `deadline` (monotonic). */
  waitEcho(dp, wanted, after, deadline) {
    return new Promise((resolve) => {
      const waiter = {
        id: dp.id,
        after,
        resolve: (ok) => {
          if (!this.echoWaiters.delete(waiter)) return;
          this.timers.clearTimeout(waiter.timer);
          resolve(ok);
        },
        check: (value) => {
          if (sameValue(dp, value, wanted)) waiter.resolve(true);
        },
      };
      this.echoWaiters.add(waiter);
      waiter.timer = this.timers.setTimeout(
        () => waiter.resolve(false),
        Math.max(0, deadline - this.clock()),
      );
    });
  }

  /** Sends a write through the link; resolves the link's answer, or undefined (may have left). */
  writeThroughLink(id, hex, deadline) {
    if (!this.session || !this.channel?.connected) return { sent: false };
    const seq = ++this.seq;
    const result = new Promise((resolve) => {
      this.results.set(seq, resolve);
      const timer = this.timers.setTimeout(
        () => {
          if (this.results.delete(seq)) resolve(undefined);
        },
        Math.max(0, deadline - this.clock()),
      );
      timer?.unref?.();
    });
    if (!this.channel.send({ type: 'write', seq, session: this.session.id, id, hex })) {
      this.results.delete(seq);
      return { sent: false };
    }
    return { sent: 'maybe', result };
  }

  async setValue(_device, feature, raw) {
    await this.boot();
    // The deadlines count from the arrival of the command.
    const received = this.clock();
    const dp = parseFeatureId(feature?.external_id);
    if (!dp?.command) {
      throw this.refuse(COMMAND.why.notWritable);
    }
    const wanted = this.parseCommand(dp, raw);
    if (STOP[dp.command] !== undefined && wanted === STOP[dp.command]) {
      return this.stopCommand(dp, received);
    }
    return this.writeCommand(dp, wanted, received);
  }

  refuse(why) {
    this.note(COMMAND.notSent(why));
    return new Refusal(why);
  }

  note(text) {
    this.lastCommand = text;
    this.logger.info(`Command: ${text.en}`);
    this.updateStatus();
  }

  /** A program key, or a whole hot water setpoint in °C (strict: '', null, '1e2', true refused). */
  parseCommand(dp, raw) {
    if (dp.command === 'dhw-setpoint') {
      const value =
        typeof raw === 'number'
          ? raw
          : typeof raw === 'string' && /^\s*\d{1,3}(?:\.0+)?\s*$/.test(raw)
            ? Number(raw)
            : NaN;
      if (!Number.isInteger(value) || value < DHW_SETPOINT.min || value > DHW_SETPOINT.max) {
        throw this.refuse(
          Number.isFinite(value) && value > DHW_SETPOINT.max
            ? COMMAND.why.aboveCap(Math.min(this.config.dhwCap, DHW_CAP.max))
            : COMMAND.why.invalid,
        );
      }
      if (value > this.config.dhwCap || value > DHW_CAP.max) {
        throw this.refuse(COMMAND.why.aboveCap(Math.min(this.config.dhwCap, DHW_CAP.max)));
      }
      return value;
    }
    if (typeof raw !== 'string' || !Object.hasOwn(SELECTABLE[dp.command], raw)) {
      throw this.refuse(COMMAND.why.invalid);
    }
    return raw;
  }

  /**
   * The stop: never held. Kept first (in memory at once, in /data without
   * waiting), sent now when the ISM8 is connected, otherwise at its next
   * session. Never refused.
   */
  async stopCommand(dp, received) {
    const epoch = (this.stopEpochs.get(dp.slug) ?? 0) + 1;
    this.stopEpochs.set(dp.slug, epoch);
    this.memory.stops.set(dp.id, { at: this.now(), attempts: 0, confirmed: false });
    this.stopState.set(dp.id, { lastSent: -Infinity, contra: 0 });
    const after = this.clock();
    const seq = this.sendStop(dp.id, 'click');
    this.saveMemory();
    if (seq === undefined) {
      this.note(COMMAND.kept);
      return { kept: true };
    }
    const confirmed = await this.waitEcho(
      dp,
      STOP[dp.command],
      after,
      received + TIMINGS.commandAnswer,
    );
    this.note(confirmed ? COMMAND.success : COMMAND.unconfirmed);
    return { confirmed };
  }

  async writeCommand(dp, wanted, received) {
    if (!this.config.allowWrites) {
      throw this.refuse(COMMAND.why.writesOff);
    }
    if (this.running.has(dp.id)) {
      throw this.refuse(COMMAND.why.busy);
    }
    const guard = this.memory.stops.get(dp.id);
    const otherStop = [...this.memory.stops].some(
      ([id, stop]) => id !== dp.id && !stop.confirmed && DATAPOINTS.get(id)?.slug === dp.slug,
    );
    if (otherStop || (guard && !guard.confirmed && dp.command === 'dhw-setpoint')) {
      throw this.refuse(COMMAND.why.stopRunning);
    }
    if (!this.session) {
      throw this.refuse(COMMAND.why.noSession);
    }
    const current = this.freshValue(dp.id);
    if (current === undefined) {
      throw this.refuse(COMMAND.why.unknownValue);
    }
    if (sameValue(dp, current, wanted) && !guard) {
      this.note(COMMAND.already);
      return { already: true };
    }
    const promise = this.sendWrite(dp, wanted, received);
    this.running.set(dp.id, promise);
    try {
      return await promise;
    } finally {
      if (this.running.get(dp.id) === promise) this.running.delete(dp.id);
    }
  }

  async sendWrite(dp, wanted, received) {
    const epoch = this.stopEpochs.get(dp.slug) ?? 0;
    const session = this.session.id;
    const hex = encodeCommand(dp, wanted).toString('hex');
    // A program chosen by the user lifts a stop of that program: removed from
    // /data before the bytes leave (otherwise a restart would send the stop
    // again over the user's choice), put back if nothing was sent.
    const guard = this.memory.stops.get(dp.id);
    if (guard) {
      this.memory.stops.delete(dp.id);
      if (!(await this.saveMemory())) {
        this.memory.stops.set(dp.id, guard);
        throw this.refuse(COMMAND.why.dataSave);
      }
    }
    const restore = () => {
      if (guard && !this.memory.stops.has(dp.id)) {
        this.memory.stops.set(dp.id, guard);
        this.saveMemory();
      }
    };
    // Right before the bytes leave: the latest configuration, no stop since
    // the click, the same ISM8 session, the deadline.
    const why = this.beforeSend(dp, wanted, { epoch, session, received });
    if (why) {
      restore();
      throw this.refuse(why);
    }
    const after = this.clock();
    const write = this.writeThroughLink(dp.id, hex, received + TIMINGS.commandAnswer);
    if (!write.sent) {
      restore();
      throw this.refuse(COMMAND.why.link);
    }
    if (guard) this.stopState.delete(dp.id);
    this.followUp();
    this.later(`echo-${dp.id}`, TIMINGS.echoRead, () => this.readAll('echo', { force: true }));
    const echo = this.waitEcho(dp, wanted, after, received + TIMINGS.commandAnswer);
    const answer = await write.result;
    if (answer && answer.sent === false) {
      // The link did not write it (another ISM8 session, its rate): nothing left.
      for (const waiter of [...this.echoWaiters]) if (waiter.id === dp.id) waiter.resolve(false);
      restore();
      throw this.refuse(COMMAND.why.link);
    }
    const confirmed = await echo;
    this.note(confirmed ? COMMAND.success : COMMAND.unconfirmed);
    return { confirmed };
  }

  /** The checks right before the bytes leave; the reason of a refusal, else undefined. */
  beforeSend(dp, wanted, { epoch, session, received }) {
    if (!this.config.allowWrites) return COMMAND.why.writesOff;
    if ((this.stopEpochs.get(dp.slug) ?? 0) !== epoch) return COMMAND.why.stopRunning;
    if (!this.session || this.session.id !== session || !this.channel?.connected) {
      return COMMAND.why.noSession;
    }
    if (dp.command === 'dhw-setpoint' && (wanted > this.config.dhwCap || wanted > DHW_CAP.max)) {
      return COMMAND.why.aboveCap(Math.min(this.config.dhwCap, DHW_CAP.max));
    }
    if (this.clock() - received > TIMINGS.commandSend) return COMMAND.why.late;
    return undefined;
  }
}
