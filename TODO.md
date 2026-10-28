# TODO — Wolf ISM8 v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- No forum post from a module session; the `gladys-assistant-integration`
  topic is added at the first real release only.

## Status

- [x] **Milestone 1 — core** (2026-10-28): the `ism8-link` sub-container
      (TCP endpoint of the ISM8i, bounded, sender checked, one session),
      the private channel, decoding of the wolf_ism8 table, one device per
      Wolf element, hot water setpoint and programs behind `allow_writes`,
      the stop never held and kept in /data, docs en/fr, cover. Tested
      against a fake ISM8 (loopback) and in the sandbox Gladys (connection
      from another network namespace: source address kept, ack and "request
      all" received).
- [ ] **Milestone 2 — real ISM8i**: run against a real module (see below),
      record a session (frames, no address) as fixtures.
- [ ] **Milestone 3 — more**: energy counters of the solar module (with the
      approved guard of gladys-p1-monitor), CWL ventilation program and air
      flows, the one-off hot water charge (a button, behind the option), the
      time programs (a select like Home Assistant), heat pump cooling
      programs, `first_fw_version` filtering.

## To check on a real ISM8i

- The "request all datapoints" frame: wolf_ism8 sends 12 bytes whose size
  field says 22 (`0x16`); ported byte for byte. Does the ISM8i answer it
  with every value? Does it also send every value by itself at connection?
- How fast the ISM8i reconnects after the link restarted (every main
  container restart, see Decisions).
- Whether the ISM8i reports a written datapoint back (the confirmation of a
  command relies on it, plus the full read 1.2 s after the write): if not,
  every command stays "sent, without confirmation" until a follow-up read.
- The unit of the system pressure (`DPT_Value_Pres`, Pa per KNX, values
  around 1.5 would mean bar): published raw, `unknown/decimal`, until then.
- The program codes (HVACMode 0-3, DHWMode 0/2/4) against the BM-2 display;
  standby keeping the frost protection (Wolf documentation).
- How often the ISM8i sends the keep-alive (767) and whether it reconnects
  by itself after a network cut (the link replaces the old session).
- The ISM8i sends its values from its own address: check the "Check the
  sender" option against a real Docker install (Docker Desktop and rootless
  Docker may hide it).

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and both `docker_image` tags (`ghcr.io/lm1lc3n7/gladys-wolf-ism8:0.1.0`);
  the first patch release gives 0.1.1. `test/manifest.test.js` checks they agree.
- **Reference**: wolf_ism8 4.3 (MIT, Marc Schmiedchen, commit 2276211) for
  the protocol, the datapoint table (`src/ism8/table.js`, generated from
  `ism8_constants.py`, undocumented block 336-354/362/363 left out) and the
  decoders; home-assistant-wolf_ism8 4.6 (MIT, commit eb1f224) for the
  server role and the entities. Cloned read only in `~/code/ref/lot18/`.
  Notices in `THIRD_PARTY_NOTICES.md`, shipped in the image with `LICENSE`.
- **Incoming connection**: the main container cannot publish a port; the
  `ism8-link` sub-container (same image, `node src/receiver.js`,
  `start: manual`, read only, 64 MB) publishes container port 12004 on a
  host port chosen by Gladys (`{{port:ism8}}` in the connection section).
  The ISM8i's own port (12004 by default) is configurable in its web page:
  the user types the port Gladys chose. Started only once a valid ISM8
  address is saved, stopped when it is removed (nothing listens before).
- **Checked in the sandbox Gladys** (2026-10-28, Docker with iptables-nft,
  `userland-proxy: false`): Gladys publishes `0.0.0.0:<port>`; a client in
  another network namespace (192.168.77.2, routed through the host like a
  LAN machine) reached `<host IP>:<port>`, was seen with its own address
  (DNAT keeps the source), got the ack and the "request all"; the values
  reached the main container. A client on the Gladys machine itself is seen
  as the Docker gateway (MASQUERADE of locally generated traffic): said in
  the docs, with Docker Desktop and rootless Docker.
  Also seen there: Gladys restarts the link whenever the main container
  restarts (the ISM8 session drops; the ISM8i must reconnect by itself), and
  the main container reached the new link only after 20-35 s, its ARP entry
  for the link's address still holding the MAC of the old container
  (`ip neigh`: PROBE on the old MAC). Hence the channel drops a connect
  attempt after 3 s and the background round asks it to try again every
  10 s; at boot, a kept stop can leave on the link still running from
  before (it did connect within 15 ms there).
- **Sender check** (`check_source`, on by default): the link closes a
  connection from another address before reading a byte and tells the main
  container (address only, at most every 10 s); turning it off is documented
  as the Docker-hides-the-address case only.
- **Link bounds**: 4 sockets, one ISM8 session (a new connection of the ISM8
  replaces the old one, never two), frames 2048 bytes / 300 datapoints
  checked whole, a stream not starting with the header refused, an
  incomplete frame closed after 5 s, 400 frames per 10 s, 20 writes per 10 s,
  500 messages queued while the main container is away. Every valid
  SetDatapointValue.Req is acknowledged at once (wolf_ism8 does the same).
- **Channel**: JSON lines over the private network, mutual HMAC
  challenge-response (from gladys-nasweb), made two-way (writes and "request
  all" from the main container, answered `sent: true|false`). The secret is
  generated by the main container and kept in `/data/ism8.json` only (not a
  user secret; there is none), so a kept stop can leave at start-up before
  `getConfig()`.
- **Identity**: the ISM8 protocol carries no serial: one ISM8 per
  integration, device ids `wolf-ism8:<slug>` per Wolf element, features
  `dp-<id>`. A session id (from the link) tags every value: a decision uses
  only a value of the current session, at most 15 min old (a full read every
  5 min keeps them fresh).
- **Values**: decoded only in the main container; the KNX "invalid" float,
  a wrong length, an unknown datapoint, a command byte other than 0x03 or a
  value outside the plausibility range of its kind is dropped. Modes and the
  fault code are texts, never a number. Pressure, percentages, temperature
  differences and flows are `unknown/decimal`, the unit in the name.
  Values older than a minute (queued by the link, or waiting for Gladys)
  are never published; Gladys reconnecting forgets what was published and
  asks the ISM8 for fresh values instead.
- **Writes** (`allow_writes`, off, only `true` allows): the 12 datapoints of
  `COMMANDS` only (hot water setpoints 56/69/82/95, heating programs
  57/70/83/96, hot water programs 58/71/84/97). Hot water: whole degrees,
  20 °C to `dhw_max_temperature` (65 by default, 20-65, never above 65);
  programs: auto/comfort/eco/standby and auto/continuous/standby (Wolf's
  frost protection, cooling and legionella programs are shown, not offered).
  Checked on arrival and in `beforeSend` (option, ceiling, no stop since the
  click, same session, sent within 2.5 s); one command per datapoint;
  success only on a value read back after the write (3.4 s at most), a
  value equal to the one before is not a confirmation; otherwise "sent,
  without confirmation" and full reads 1.2, 5 and 20 s after. The link not
  writing it gives "not sent". The ack never waits for Gladys.
- **The stop** (standby program, heating or hot water): never held (no
  option, bound, read, busy setting, getConfig). Kept in `/data` (`stops`),
  sent at once when a session is up, else at the next session (3 attempts
  in all, an attempt the link did not write does not count), sent again 5 s
  apart while a read contradicts it before confirmation. Confirmed by a
  read; after that never sent again: lifted by two reads in a row of another
  program (changed at the boiler) or a user click on another program with
  the option (removed from /data before the bytes leave, put back if
  nothing left; a failed save refuses that click). Never lifted by time. While
  a stop of a circuit is unconfirmed, every other write on that circuit is
  refused (its hot water setpoint, its other program). A
  failed save never holds the stop; an unreadable /data is never
  overwritten (the stop is then kept in memory only).
- **getConfig()** failing in `connected`: retried 5 s, 10 s, 30 s, 1 min,
  then every 2 min without end, status "configuration could not be read";
  configurations saved back to back are applied one after the other.
- **Rate**: the publisher sends at most 250 states a minute, unchanged
  values skipped (`publishChangedStates`).
- **gladys_version >= 5.1.0** (sub-containers and `{{port:}}`); category
  `climate`, transport `local`; no `keywords`/`countries`.
- **Template demo files** (devices, scenes, widgets, weather and their
  tests) removed.
- **Not checked here**: duplicates in the store and the forum (done when the
  lot was reserved); a real ISM8i.
