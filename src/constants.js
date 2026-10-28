// -----------------------------------------------------------------------------
// Frozen keys, limits and timings.
// -----------------------------------------------------------------------------

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/** The manifest actions (keys frozen). */
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

/** The sub-container the ISM8 connects to (manifest `containers`). */
export const LINK = Object.freeze({
  name: 'ism8-link',
  portName: 'ism8',
  ism8Port: 12004,
  channelPort: 7779,
});

/** The device type of the external ids: `ext:<selector>:wolf-ism8:<device slug>`. */
export const DEVICE_TYPE = 'wolf-ism8';

/** Hot water ceiling: configured between `min` and `max`, never above `max`. */
export const DHW_CAP = Object.freeze({ default: 65, min: 20, max: 65 });

export const LIMITS = Object.freeze({
  /** Open TCP connections on the ISM8 port, all sources together. */
  linkSockets: 4,
  /** Frames a session may send per framesWindow (a full dump is ~300 frames). */
  frames: 1000,
  framesWindow: 10 * SECOND,
  /** An incomplete frame older than this closes the connection. */
  frameStall: 5 * SECOND,
  /** Writes and "read everything" of the main container per linkWritesWindow. */
  linkWrites: 20,
  linkWritesWindow: 10 * SECOND,
  /** "Request all" at most this often, whoever asks. */
  linkReadAllSpacing: 30 * SECOND,
  /** Messages the link keeps while the main container is away. */
  linkQueue: 500,
  /** A refused connection is told to the main container at most this often. */
  refusedNoticeEvery: 10 * SECOND,
  /** Datapoints handled per message from the link (the frame bound). */
  itemsPerMessage: 300,
  /** Gladys accepts 300 states a minute: 250 leaves room. */
  statesPerMinute: 250,
  statesPerRequest: 100,
  /** Attempts of one stop (the first one included). */
  stopAttempts: 3,
  /** Text length in a status. */
  status: 600,
});

export const TIMINGS = Object.freeze({
  /** The background round: status, link, refresh, follow-up reads. */
  tick: 10 * SECOND,
  flushInterval: SECOND,
  stateHeartbeat: 30 * MINUTE,
  /** "Request all" at most this often (button, Gladys reconnecting, a second read of a stop). */
  refreshButton: 30 * SECOND,
  /** Values older than this (kept by the link while this container was away) are dropped. */
  valueMaxAge: MINUTE,
  /** The link is started again at most this often while it is not running. */
  linkRetry: MINUTE,
  /** getConfig() retried after a failure: 5 s, 10 s, 30 s, 1 min, then every 2 min. */
  configRetry: [5 * SECOND, 10 * SECOND, 30 * SECOND, MINUTE, 2 * MINUTE],
  /** A command: sent within `commandSend` of the click, answered within `commandAnswer`. */
  commandSend: 2500,
  commandAnswer: 3400,
  /** A stop resent at most this often when a read contradicts it before it was confirmed. */
  stopResendSpacing: 5 * SECOND,
  /** No "request all" this long after an unconfirmed stop was sent (its 12/22 bytes). */
  stopQuiet: 20 * SECOND,
  /** A stop not confirmed this long after sending (a read at ~21 s included): sent again. */
  stopResend: 35 * SECOND,
  /** A stop sent this soon after a "request all" is sent again after stopShadowResend. */
  readAllShadow: 10 * SECOND,
  stopShadowResend: 3 * SECOND,
  /** A grouped read this long after a write (the ISM8 may not report it back). */
  followUp: 5 * SECOND,
  /** A link running whose channel never comes up for this long is started again... */
  linkSilent: 3 * MINUTE,
  /** ...at most this often. */
  linkForceSpacing: 10 * MINUTE,
  /** A new ISM8 session without any value after this: one "request all". */
  sessionRead: 2 * SECOND,
  /** A confirmed stop contradicted once: read again this long after. */
  contraRead: 5 * SECOND,
});
