# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version: the Wolf heating system through an ISM8i (or ISM8) module,
  locally. The ISM8i connects to the `ism8-link` sub-container, whose port
  Gladys publishes once the address of the ISM8i is saved (nothing listens
  before), the sender checked by default.
- One device per Wolf element reported (boilers, heat pumps, circuits,
  cascade, mixer and solar modules, ventilation, BM-2): temperatures, power,
  states, programs and operating states as texts, the last fault code.
- Hot water setpoint (20 °C to a ceiling of 65 °C at most) and heating and
  hot water programs of the direct and mixer circuits, behind an option off
  by default; the standby program (the stop) is never blocked, kept in
  `/data` and sent at the next connection of the ISM8i.
- A button to read every value again.
