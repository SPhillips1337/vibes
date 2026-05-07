# Architectural Decision: Stability & Logging Strategy

## Context
During development with `tsx watch`, the application experienced infinite restart loops. This was traced to the fact that the application's logger was writing to a file (`debug.log`) within the watched project root. Each write triggered a file system event, causing the watcher to restart the process, which in turn triggered a new "Session Started" log entry.

## Decision
1.  **Out-of-Tree Logging**: Move the primary debug log to a system temporary directory (`/tmp/vibes-debug.log`). This ensures it is physically outside the project's watch scope.
2.  **Watcher Exclusions**: Explicitly exclude metadata and build directories (`.vibes/`, `dist/`) in the `dev` script using the `--exclude` flag.
3.  **Controlled Startup**: Move the `console.clear()` and `initLogger()` calls into a strictly controlled initialization phase to prevent double-clearing of the terminal screen during UI re-renders.

## Status
**Active** (Implemented 2026-05-07)

## Consequences
- **Positive**: Terminal UI stability is dramatically improved; users can type in form fields without the app resetting.
- **Positive**: Reduced CPU usage as the process is no longer constantly spawning/killing.
- **Neutral**: Users must now look in `/tmp` for debug logs instead of the project root.
