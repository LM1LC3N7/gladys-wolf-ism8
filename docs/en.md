# Wolf ISM8 for Gladys Assistant

This integration shows in Gladys the Wolf heating system connected to an
**ISM8i** (or ISM8) module: gas and oil boilers, heat pumps, direct and mixer
circuits, cascade module, solar module, CWL ventilation, BM-2 control unit.
Everything stays on your local network, without any cloud nor Wolf account.

Unofficial integration, not affiliated with Wolf. **Never tested with a real
ISM8i**: it follows the ISM8 interface description published by Wolf and the
wolf_ism8 library (MIT) of the Home Assistant integration. Your feedback with
a real module is welcome.

## What you get

One Gladys device per Wolf element the ISM8i reports, with one feature per
value received:

- temperatures (boiler, flow, return, hot water, outdoor, flue gas, solar
  collector, room...), in °C;
- power of the heat pumps and of the solar module, in kW;
- states (burner, pumps, valves, fault, outputs), read only;
- operating states and programs as texts (never published as a measure 0),
  the last fault code;
- percentages (burner, modulation, ventilation), setpoint corrections (K),
  flows (l/h) and the system pressure (raw value, as the ISM8i sends it) as
  plain values, the unit in the name;
- the hot water setpoint and the heating and hot water programs of the direct
  circuit and of the mixer circuits 1 to 3, which can be changed (see below).

A device shows in the **Discovery** tab once the ISM8i sent one of its values.
Not shown in this version: dates and times, the energy counters of the solar
module, the air flows of the ventilation, the detection bit fields of the
BM-2.

## How the ISM8i reaches Gladys

The ISM8i opens the connection (TCP) itself, towards the server typed in its
web page; Gladys does not poll the module. So the integration starts a small
receiver next to it (the `ism8-link` container), whose port Gladys publishes
on the machine.

1. Give the ISM8i a fixed IP address in your router.
2. In the **Configuration** screen of the integration, type that address and
   save. **Nothing listens before**: the receiver starts only once a valid
   address is saved, and stops if you clear it.
3. Reload the screen: the "How the ISM8i reaches Gladys" section shows the
   port Gladys chose (a free port, kept afterwards). The ISM8i uses 12004 by
   default: replace it with this port.
4. In the web page of the ISM8i, set the server address to the IP address of
   the Gladys machine on your network, and this port.
5. The status of the integration turns to "ISM8i connected" at the first
   connection; every value is then asked from the module.

### The network: what was checked

The Gladys core runs on the **host network** of the machine
(`network_mode: host`), but integrations run in isolated containers, on a
private Docker network: they cannot listen on the machine themselves. The
`ism8-link` receiver is a sub-container declared in the manifest, whose TCP
port 12004 Gladys publishes on **every address of the machine**
(`0.0.0.0:<chosen port>`). The ISM8i therefore reaches
`<IP address of the Gladys machine>:<port shown>`.

Checked in a test Gladys running in Docker (2026-10-28): nothing listens
before the address is saved; once saved, the port is published, a
connection from another address of the network arrives with **its real
source address** (Docker keeps it for traffic coming from the network) and
gets the acknowledgement and the request for every value; a connection
started on the Gladys machine itself arrives with the address of the Docker
gateway instead.

Hence:

- if your machine has a firewall, allow this TCP port;
- the **Check the sender** option (on by default) accepts only the address
  of the ISM8i; another address is refused before any byte is read, and the
  status shows the address seen. With Docker Desktop (Mac, Windows) or
  rootless Docker, Docker may replace the source address: the status then shows
  connections refused from an internal address; turn the option off in that
  case only (any machine of the network can then send values in place of the
  ISM8i);
- through Gladys Plus or a proxy, the address your browser shows is not the
  one the ISM8i must reach: use the local address of the machine.
- when the integration restarts (update, Gladys restart), Gladys restarts the
  receiver too: the connection of the ISM8i drops, the ISM8i reconnects by
  itself, and the integration finds the receiver again within about 30 s
  (the time Docker takes to forget the old container).

## Changing settings

Off by default. With **Allow changing the settings**:

- **hot water setpoint**: whole degrees, from 20 °C to the hot water ceiling
  (65 °C by default, adjustable from 20 to 65 °C, never above 65 °C whatever
  is typed); a value above is refused, and the ceiling is checked again
  right before sending;
- **heating program**: automatic, heating (comfort), eco, standby;
- **hot water program**: automatic, continuous, standby.

A command leaves only if the option is on when it arrives **and** right
before sending, if the ISM8i is connected, and if the current value was
received during its current connection. It is said applied only when the
ISM8i reports the new value back; otherwise "sent, without confirmation",
and every value is asked again 5 and 20 s later. The outcome shows in the
status of the integration.

Never written: power and temperature presets of the boilers, time programs,
the one-off hot water charge, ventilation, and any other value.

### The stop (standby program) is never blocked

Choosing **Standby** (off, the frost protection of the Wolf controller
staying active) for the heating or the hot water of a circuit is always accepted:
option off, ceiling, value not read yet, another command running,
configuration not yet read from Gladys, nothing holds it. It is kept in
`/data` and:

- leaves at once when the ISM8i is connected;
- otherwise leaves at the next connection of the ISM8i (and, after a restart
  of the integration, as soon as the receiver answers, even before the
  configuration is read);
- is sent again, 5 s apart, when a value read contradicts it before it was
  confirmed, 3 sendings at most in all; beyond that, the status asks you to
  check the boiler.

The only cases where it does not leave at once: the ISM8i is not connected,
or the receiver is not running (address not saved yet); it then waits in
`/data`. Once confirmed it is never sent again: a program changed later on
the boiler or in the Wolf app, read twice in a row, lifts the stop without
being fought. Choosing another program in Gladys (option on) lifts it too.
Time alone never lifts it.

While a stop of a circuit is not confirmed, every other change of that
circuit is refused (its hot water setpoint, its other program); choosing
another program for the stopped one stays allowed (it lifts the stop).

## Security

- The ISM8 protocol has **no password** and travels in clear: keep the ISM8i
  and Gladys on a trusted network.
- The receiver accepts 4 connections at most, one ISM8 session at a time (a
  new connection of the ISM8i replaces the old one), frames of 2048 bytes and
  300 values at most, checked whole; a malformed frame, a frame incomplete
  for 5 s or a flood of more than 400 frames in 10 s closes the connection.
- The channel between the receiver and the integration goes through the
  private network of the integration, with a mutual proof of a secret the
  integration generates.

## The "Read every value again" button

Asks the connected ISM8i to send every value again (at most every 30 s). The
integration also does it at every connection, every 5 minutes and after each
command.

## Troubleshooting

- **"Waiting for the ISM8i"**: check the server address and the port in the
  page of the ISM8i, the firewall of the Gladys machine, and that the ISM8i
  is on the same network.
- **"connection(s) refused from ..."**: the address seen is not the one
  typed; fix the address, or see above (Docker hiding the address).
- **A value is missing**: the ISM8i only sends what your installation has; a
  value outside its plausible range is never published.
- **Odd pressure**: the pressure is published as the ISM8i sends it; its real
  unit is still to be confirmed on a real module.

## Credits

Protocol and table of values ported from
[wolf_ism8](https://github.com/marcschmiedchen/wolf_ism8) and
[home-assistant-wolf_ism8](https://github.com/marcschmiedchen/home-assistant-wolf_ism8)
by Marc Schmiedchen (MIT license), see `THIRD_PARTY_NOTICES.md`.
