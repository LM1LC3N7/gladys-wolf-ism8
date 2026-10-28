# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported to JavaScript from the projects below. The ported parts
were rewritten, not copied; the changes are described below.

## wolf_ism8

<https://github.com/marcschmiedchen/wolf_ism8> (Python package `wolf_ism8`,
the protocol library of the Home Assistant integration below), by Marc
Schmiedchen. MIT License (`LICENSE` of the repository, version 4.3, commit
2276211 of 2026-10-10).

Ported: the ISM8 frames (header, acknowledgement, write of a datapoint,
"request all datapoints", byte for byte), the datapoint table
(`src/ism8/table.js`: ids, Wolf devices, names, data types, writable flags,
the undocumented block left out), the decoding of the data types (KNX
DPT 9 floats, scaling, booleans, the program and state lists, appliance
types), the allowed values of the writes (hot water 20-80 °C, the hot water
programs automatic / continuous / standby), the plausibility bound on the
power (1000 kW). Changes: frames checked whole and bounded before use (a
stream that does not start with the header is refused instead of searched),
a negative DPT 9 value with a zero mantissa decoded as the KNX standard says, temperatures
without the jump filter (an implausible value is dropped instead), writes
limited to the hot water setpoint (65 °C at most) and the programs of the
circuits.

## home-assistant-wolf_ism8

<https://github.com/marcschmiedchen/home-assistant-wolf_ism8> (the Home
Assistant integration "Wolf Climate Control ISM8"), by Marc Schmiedchen.
MIT License (`LICENSE` of the repository, version 4.6, commit eb1f224 of
2026-10-12).

Read for: the ISM8 as a TCP client of the server (port 12004 by default),
the grouping of the datapoints by Wolf device, the entities shown (sensors,
binary sensors, program selects), the "request all datapoints" button.

Both projects carry the same notice:

```
MIT License

Copyright (c) 2026 Marc Schmiedchen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The protocol itself is described by Wolf in the ISM8 / ISM8i interface
description ("Schnittstellenbeschreibung"), which both projects follow.

The channel between the two containers (`src/channel.js`) and the state
publisher (`src/publisher.js`) come from LM1LC3N7/gladys-nasweb and
LM1LC3N7/gladys-stiebel-eltron (same author, Apache-2.0).
