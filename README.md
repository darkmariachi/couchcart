# RomM Launcher

A couch-friendly desktop launcher for a self-hosted [RomM](https://romm.app) library. It browses
the library, downloads games, starts them in a locally installed RetroArch, and syncs saves
through RomM. It is a launcher and sync client: RetroArch does all emulation and must be
installed separately.

Status: Milestone 3 (browse via a debug screen, download, launch in RetroArch, save and state sync).

## Development

Requires Node 22+.

```bash
npm install
npm run dev
```

| Script                               | What it does                                         |
| ------------------------------------ | ---------------------------------------------------- |
| `npm run dev`                        | Start the app with hot reload                        |
| `npm run build`                      | Build main, preload and renderer into `out/`         |
| `npm test`                           | Unit tests (Vitest, RomM faked with msw)             |
| `npm run typecheck` / `npm run lint` | Static checks                                        |
| `npm run api:fetch -- <url>`         | Download the OpenAPI spec from a RomM instance       |
| `npm run api:types`                  | Regenerate `src/main/romm/schema.d.ts` from the spec |

## Layout

- `src/main`: RomM client, auth, settings, IPC handlers (Node side).
- `src/preload`: the narrow `window.romm` bridge.
- `src/renderer`: React UI. It has no network or Node access; everything goes through IPC.
- `src/shared/ipc.ts`: the contract between the two sides.
- `docs/romm-api-notes.md`: the RomM endpoints the launcher relies on.

## Credentials

Only the token pair is stored, encrypted with the OS keychain (Electron `safeStorage`) in the
app data folder. The password is never written to disk.
