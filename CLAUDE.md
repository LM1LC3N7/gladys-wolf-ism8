# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk`, its only
runtime dependency. It shows a Wolf heating system through an ISM8i (or ISM8)
module. The ISM8i is a TCP **client**: it connects to the server typed in its
web page. The main container cannot publish a port, so the same image also
runs the `ism8-link` sub-container (manifest `containers`), the TCP endpoint
the ISM8i connects to; the two talk over a private authenticated channel.
Never tested with a real ISM8i, not affiliated with Wolf.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npm run cover                             # cover.png (800x534), plain Node
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` (Node 22 and 24) and `audit` before every
commit.

## Architecture

```
index.js                  SDK bootstrap only (/data first, then Gladys)
src/handlers.js           every SDK handler -> the app (shared with the tests)
src/app.js                Ism8App: link lifecycle, session, values, status,
                          commands, the stops kept in /data
src/channel.js            private channel between the two containers (HMAC both ways)
src/link/service.js       the ism8-link sub-container: TCP endpoint, bounds, acks
src/receiver.js           entry point of the sub-container
src/ism8/protocol.js      ISM8 frames: parse, ack, write, request all (wolf_ism8)
src/ism8/table.js         the datapoint table of wolf_ism8 (generated, do not edit)
src/ism8/datapoints.js    kinds, decoding, ranges, the writable datapoints
src/model.js              -> Gladys devices, features and states (pure)
src/publisher.js          states within 250/min, never older than a minute
src/store.js              /data/ism8.json: channel secret, datapoints seen, stops
src/config.js             config_schema normalized
src/constants.js          keys, limits, timings, the hot water ceiling
src/i18n.js               names and texts (en/fr)
test/fixtures/ism8.js     frames, a fake ISM8 client, a fake channel, the setup
scripts/cover.mjs         cover.png generator
```

## Rules

- **External ids are forever**: device `wolf-ism8:<slug>` (slugs in
  `src/ism8/datapoints.js` GROUPS), features `dp-<Wolf datapoint id>` and
  `dp-<id>-text` (the read-only twin of a program select). A republished
  device never loses a feature (`keepCreatedFeatures`).
- Manifest keys (`ism8_address`, `check_source`, `allow_writes`,
  `dhw_max_temperature`, `language`, the action `refresh`, the container
  `ism8-link` and its port name `ism8`) are frozen.
- **Nothing listens before the configuration**: the link starts only with a
  valid ISM8 address, stops when it is removed.
- **Writes**: only the hot water setpoints and the heating and hot water
  programs of the circuits (`COMMANDS`); never a switch or a writable binary;
  refused unless `allow_writes` (checked on arrival and right before the
  bytes leave); decided on a value of the current ISM8 session; success only
  on a value read back after the write.
- **Hot water**: never above the configured ceiling nor 65 °C, whole degrees.
- **The stop** (standby program) is never held: no option, bound, read,
  busy setting or configuration needed. Kept in /data, sent at every new
  session while unconfirmed (3 attempts), lifted only by a user click on
  another program (bytes gone) or two reads in a row elsewhere after
  confirmation, never by time.
- **Bounds**: frames, connections, rates and queues of `LIMITS`; the link
  never decodes, the main container never trusts a value out of its range.
- Units only from the core's `DEVICE_FEATURE_UNITS_BY_CATEGORY`.
- The channel secret lives in /data only (never logged); no user secret exists.
- Files are UTF-8 without BOM (`test/encoding.test.js`).
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
