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
  /** Frames a session may send per framesWindow. */
  frames: 400,
  framesWindow: 10 * SECOND,
  /** An incomplete frame older than this closes the connection. */
  frameStall: 5 * SECOND,
  /** Writes and "read everything" of the main container per linkWritesWindow. */
  linkWrites: 20,
  linkWritesWindow: 10 * SECOND,
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
  /** A full read of the ISM8 while the session lasts. */
  refresh: 5 * MINUTE,
  /** A "read everything" button click at most this often. */
  refreshButton: 30 * SECOND,
  /** Values older than this (kept by the link while this container was away) are dropped. */
  valueMaxAge: MINUTE,
  /** A value is used by a decision only if received in the current session, within this. */
  valueFresh: 15 * MINUTE,
  /** The link is started again at most this often while it is not running. */
  linkRetry: MINUTE,
  /** getConfig() retried after a failure: 5 s, 10 s, 30 s, 1 min, then every 2 min. */
  configRetry: [5 * SECOND, 10 * SECOND, 30 * SECOND, MINUTE, 2 * MINUTE],
  /** A command: sent within `commandSend` of the click, answered within `commandAnswer`. */
  commandSend: 2500,
  commandAnswer: 3400,
  /** After a write without its echo: a full read this long after the write. */
  echoRead: 1200,
  /** Follow-up full reads after a command. */
  followUps: [5 * SECOND, 20 * SECOND],
  /** A stop resent at most this often when a read contradicts it before it was confirmed. */
  stopResendSpacing: 5 * SECOND,
});
