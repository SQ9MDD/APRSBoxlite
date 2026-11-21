# APRSBox Lite

APRSBox Lite is a lightweight desktop APRS client for Windows, macOS and Linux.

## Stack

- Use Electron, Node.js, TypeScript, Vite and Leaflet.
- Do not use Python, Rust, backend servers or databases.

## Architecture

- The Electron Main Process handles KISS connections, AX.25/APRS processing, station management, messages and in-memory history.
- The Renderer handles only the user interface.
- Preload exposes a minimal, secure IPC API. Keep `contextIsolation` enabled and `nodeIntegration` disabled.
- KISS TCP uses `node:net`; KISS Serial uses `serialport`.
- Both transports use the same KISS/AX.25/APRS decoder.

## Features

- Own station.
- APRS map.
- Station list.
- Packet monitor.
- APRS messages with ACK support.
- Beacon transmission.
- KISS TCP and KISS Serial configuration.

## Storage

- Keep received packets, position history, station activity and messages in RAM for the last 60 minutes only, with an additional memory limit.
- Do not persist APRS history or messages to disk.
- Persist only user settings in JSON under Electron `app.getPath('userData')`.

## Out of scope

- DIGI.
- iGate.
- APRS-IS for the initial version.
- Mobile support.
- Cloud sync.
- User accounts.
- SQLite.
- IndexedDB.
- REST APIs.

## Development rules

- Keep the architecture simple.
- Use TypeScript.
- Avoid unnecessary dependencies.
- Test protocol parsing.
- Work incrementally.
- Do not implement features beyond the current task.
