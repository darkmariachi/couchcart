# RomM Launcher

A couch-friendly desktop launcher for a self-hosted [RomM](https://romm.app) library. It browses
the library, downloads games, starts them in a locally installed RetroArch, and syncs saves
through RomM. It is a launcher and sync client: RetroArch does all emulation and must be
installed separately.

Status: Milestone 4 (controller UI: setup wizard, home, platform grid, game page; download, launch and save sync).

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

## Controls

| Controller         | Keyboard             | Action                                  |
| ------------------ | -------------------- | --------------------------------------- |
| D-pad / left stick | Arrow keys           | Move                                    |
| A                  | Enter                | Select                                  |
| B                  | Esc or Backspace     | Back                                    |
| X / Y              | X / Y                | Shown in the footer (search, sort, ...) |
| LB / RB            | Q / E or PgUp / PgDn | Previous / next platform                |
| Start              | F1                   | Menu (fullscreen, sign out, exit)       |

The window starts fullscreen. Pass `--windowed` or `--fullscreen` to override the setting;
`npm run dev` starts windowed.

## Layout

- `src/main`: RomM client, auth, settings, IPC handlers (Node side).
- `src/preload`: the narrow `window.romm` bridge.
- `src/renderer`: React UI. It has no network or Node access; everything goes through IPC.
- `src/shared/ipc.ts`: the contract between the two sides.
- `docs/romm-api-notes.md`: the RomM endpoints the launcher relies on.

## Credentials

Only the token pair is stored, encrypted with the OS keychain (Electron `safeStorage`) in the
app data folder. The password is never written to disk.
