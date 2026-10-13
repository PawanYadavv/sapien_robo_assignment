# Sketch Party

A real-time multiplayer drawing game built with React + TypeScript on the frontend and Node.js + Express + Socket.IO on the backend. This project emphasizes server-authoritative game state, real-time canvas synchronization, room management, and a clean single-command workflow for local development.

## Features

- Room creation and join flow with shareable room codes
- Host-controlled round configuration
- Drawer/guesser turn management with private word selection
- Server-authoritative scoring, duplicate guess prevention, and timer enforcement
- Real-time canvas drawing updates with ordered drawing events
- Chat with message size and rate limits
- Reconnection and late-join state reconstruction
- Automated tests for the highest-risk server logic

## Prerequisites

- Node.js 20+
- npm 10+

## Installation

```bash
npm install
```

## Run locally

From the repository root:

```bash
npm run dev
```

This starts the backend and the Vite frontend together. The app is served at:

- Frontend: http://localhost:5173
- Backend: http://localhost:4001

If port 5173 is already in use, Vite may automatically choose the next available port.

## Production build

```bash
npm run build
```

## Automated tests

```bash
npm test
```

## Health check

```bash
curl.exe --silent http://localhost:4001/health
```

Expected response:

```json
{ "ok": true, "status": "healthy" }
```

## Architecture note

### Canvas synchronization and stroke data

- Drawing is transmitted as structured events instead of full canvas snapshots.
- Each event contains a stable id, sequence number, tool type, stroke points, size, and color.
- The server validates that only the current drawer submits drawing events and enforces a minimum delay between actions.
- Late joiners receive the room history and replay the stored drawing events to reconstruct the current canvas.

### Latency and event ordering

- Socket.IO provides low-latency room broadcasts for state and drawing updates.
- Sequence numbers are assigned on the server and are used to preserve meaningful order during replay.
- The game state remains authoritative on the server; clients render the authorized state rather than trust client-side decisions.

### Server restart behavior

- In-memory room state is intentionally not persisted.
- Restarting the process clears active rooms and round state.
- A production system would add durable room state, reconnect tokens, and persistence for recovery, but this initial version does not claim restart recovery.

### Capacity and measurement

- This single-server implementation is designed for a simple local deployment and is not benchmarked for production scale.
- Capacity would be measured by room count, message rate, WebSocket concurrency, CPU, memory, and event latency under load.
- No production-scale benchmark was run in this environment, so capacity remains unmeasured.

## Recording checklist for a three-player demo

1. Start the app with `npm run dev`.
2. Open three separate browser sessions or private windows.
3. In Browser 1, create a room and copy the room code.
4. In Browsers 2 and 3, join the same room code with different names.
5. Use the host controls to start the game and choose a drawing word.
6. Have the drawer draw while the guessers type guesses and chat.
7. Capture a two-minute screen recording showing multiple players in sync.
8. Do not claim a recording exists unless it was actually produced in your environment.

## Files created

- `server/src/game.ts` – authoritative room and scoring logic
- `server/src/index.ts` – Express + Socket.IO server
- `server/src/game.test.ts` – automated game logic tests
- `client/src/App.tsx` – main React game interface
- `client/src/styles.css` – game styling
- `docs/music-streaming-architecture.md` – architecture design document
- `docs/architecture-decisions.md` – summary of design tradeoffs

## Security and correctness notes

- Secret words are generated and checked on the server.
- The client never decides whether a guess is correct or awards points.
- Room chat blocks attempts to reveal hidden words.
- The drawer is the only participant allowed to stream drawing events.
- Public room payloads intentionally omit secret-word information.

## Manual testing checklist

- Create a room and join it from a second client.
- Start a round and verify the drawer gets private word choices.
- Submit a correct guess and confirm the server awards points.
- Attempt a duplicate guess and confirm it is rejected.
- Draw on the canvas and ensure the second client sees the stroke stream.
- Disconnect the drawer and confirm the round resets cleanly.
