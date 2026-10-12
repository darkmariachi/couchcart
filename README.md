# RomM Launcher

A couch-friendly desktop launcher for a self-hosted [RomM](https://romm.app) library. Browse your
games with a controller, press Play, and carry on from the same save on any PC.

It is a launcher and save-sync client. [RetroArch](https://www.retroarch.com) does all the
emulation and has to be installed separately; the launcher bundles no emulator, no cores and no
games.

## What it does

- Browses your RomM platforms, collections and favourites with cover art, by gamepad, keyboard
  or mouse, in an interface modelled on RomM's own.
- Searches your whole library.
- Downloads a game the first time you play it and starts it in RetroArch with a suitable core.
- Syncs saves and save states with RomM before a game starts and after it exits.
- Keeps working offline for games that are already downloaded, and uploads progress later.

## Requirements

- A RomM server, version 5.x. Developed against 5.4.0.
- RetroArch, either the standalone build or the Steam version, with a core installed for each
  platform you want to play.
- Windows 10 or 11. Linux runs from source but is not packaged yet.

## Install

Download one of the two files from a release, or build them yourself (see [Building](#building)):

- `RomM-Launcher-<version>-setup.exe` installs for the current user and adds a Start menu entry.
- `RomM-Launcher-<version>-portable.exe` runs without installing.

The builds are not code-signed, so Windows SmartScreen shows a warning the first time. Choose
"More info", then "Run anyway".

Both builds, and a development run, use the same data folder, so you can switch between them
without setting anything up again.

## First run

The setup wizard asks for:

1. **Your RomM address**, for example `https://romm.example.lan`.
2. **Your RomM username and password.** Only a session token is stored, encrypted by Windows.
   The password is never saved.
3. **RetroArch.** It is found automatically in the usual places, including Steam libraries. The
   wizard lists each platform in your library and whether a core for it is installed.
4. **Where to keep downloaded games**, with the free space on that drive.
5. **Existing saves.** If RetroArch already has saves for games in your library, the launcher
   offers to copy them in so you continue where you left off. RetroArch's own files are not
   touched.

## Controls

| Controller         | Keyboard             | Action                                    |
| ------------------ | -------------------- | ----------------------------------------- |
| D-pad / left stick | Arrow keys           | Move                                      |
| A                  | Enter                | Select                                    |
| B                  | Esc or Backspace     | Back                                      |
| X / Y              | X / Y                | Shown in the footer (search, sort, ...)   |
| LB / RB            | Q / E or PgUp / PgDn | Previous / next section of the top bar    |
| Start              | F1                   | Menu (search, fullscreen, sign out, exit) |

Text is entered with an on-screen keyboard; a physical keyboard types straight into it.

The bar at the top switches between Home, Platforms, Collections, Search, Downloads and
Settings, and your name at the right opens Account. LB and RB step along all of them from
anywhere; pressing up from the top row of a screen
also reaches it.

The window has no title bar. Drag it by the top bar when windowed; close it with Start →
Exit launcher.

## Library

- **Home** shows what you were playing, what was added recently, your platforms and your
  collections.
- **Collections** lists the collections you made in RomM, smart collections, and the ones RomM
  builds from game metadata. Your favourites are a collection too.
- **Favourites:** choose "Add to favourites" on a game's page. It is the same favourites list
  RomM's web interface uses.
- **Search** looks through the whole library. Inside a platform or collection, X filters just
  that list. Either way, matching games are suggested as you type: move up from the keys to
  pick one.

- **Account** (your name, top right) shows the server and its version, library totals and the
  devices that sync with RomM, and has a controller test, sign out and exit. The controller
  test shows live what each controller sends; hold B for a second to close it.

Artwork is not bundled with the launcher. Covers, screenshots, platform icons and the RomM
logo are loaded from your own RomM server and kept on disk, so they also show offline.

### In a game

RetroArch handles input once a game is running.

- **Open the RetroArch menu:** hold Start for two seconds (change this in Settings → Controllers).
  On an Xbox controller the Guide button also works. From the menu you can save and load states,
  remap buttons, and quit.
- **Quit:** RetroArch menu → Close Content (or Quit). Either one ends the session and returns to
  the launcher. A dedicated quit combination can be turned on in Settings.
- When RetroArch closes, the launcher comes back and syncs your progress.

## Controllers

The launcher asks RetroArch which controllers it sees and assigns the usable ones to player 1,
player 2 and so on, in that order. This matters because some keyboards and other devices present
themselves to Windows as game controllers; left alone, RetroArch can give one of those the
player 1 slot and put your real controller on player 2, where a single-player game ignores it.

- Settings → Controllers shows who is which player. Select a controller to make it player 1.
- Detection runs when the launcher starts and when a controller is connected. "Look for
  controllers" runs it by hand.
- Button layouts come from RetroArch's own controller profiles. To change a layout, or remap for
  one game, open the RetroArch menu during a game and go to Controls.

## Saves

- **Before a game starts** the launcher checks RomM. If another PC uploaded newer progress, it is
  downloaded first; the file it replaces goes to the backups folder.
- **After a game exits** changed saves and states are uploaded.
- **If both sides changed** since the last sync (for example two PCs were used offline), nothing
  is overwritten. You are asked which save to continue with, and the other one is kept as a backup.
  You can also decide later and keep playing on this PC's save.
- **Offline:** you can play downloaded games. Progress uploads by itself once the server is
  reachable again, and games waiting to upload show a "Not synced" badge.
- **Deleting a save in RomM** removes it on your PCs too, after a backup, unless a PC has newer
  progress, in which case that progress is uploaded again. A save that goes missing on a PC is
  restored from RomM.
- The last 10 backups per game are kept (configurable) in the `save-backups` folder.

Saves are stored in RomM's `autosave` slot, the same one RomM's browser player uses, so progress
made there continues here when the core is the same.

Save states only work between PCs running the same version of the same core.

## Downloaded games

Games are kept on disk so they start instantly the next time. Settings → Storage controls this:

- **Until the size limit is reached** (default, 20 GB): the games you have not played for longest
  are removed to make room.
- **Always:** nothing is removed automatically.
- **Never:** a game is removed when you stop playing it, and downloaded again next time.

Saves are stored separately and are never removed by any of these.

Multi-disc games are downloaded into one folder with a playlist, so discs can be swapped from the
RetroArch menu.

## Adding it to Steam

1. In Steam: **Games → Add a Non-Steam Game to My Library → Browse**, and pick the launcher. The
   installer puts it in `%LOCALAPPDATA%\Programs\RomM Launcher\RomM Launcher.exe`.
2. Right-click the new entry → **Properties**. Set the name to "RomM Launcher" and, if you want to
   force it, the launch options to `--fullscreen` (use `--windowed` for the opposite).
3. Start it from Big Picture like any other game.

### Artwork

Steam does not fetch artwork for non-Steam games. In the library, right-click the game →
**Manage → Set custom artwork** for the cover; right-click the banner area of the game's page for
the background and logo. The sizes Steam uses:

| Slot                      | Size        |
| ------------------------- | ----------- |
| Cover (portrait capsule)  | 600 × 900   |
| Wide cover (recent games) | 920 × 430   |
| Background (hero)         | 3840 × 1240 |
| Logo (transparent PNG)    | 1280 × 720  |

`build/icon.png` in this repository is the app icon and can be used as a starting point.

### Steam and controllers

Steam Input may present your controller to games as a generic Xbox controller. That is fine: the
launcher detects whatever RetroArch sees at that moment. If a game does not respond after
switching between starting from Steam and starting from the desktop, open Settings → Controllers
and choose "Look for controllers".

In Big Picture the Guide button belongs to Steam, so use the hold-Start combination to open the
RetroArch menu.

## Settings

Open the menu (Start or F1) → Settings.

- **Controllers:** player order, and the combinations for the RetroArch menu and quitting.
- **RetroArch:** program location, cores folder, fullscreen, extra launch options.
- **Cores:** which core each platform uses. A single game can use a different one from its page.
- **Storage:** games folder, what to keep, size limit.
- **Saves:** sync everything now, import saves from RetroArch, how many backups to keep.
- **This device:** the name shown in RomM, launcher fullscreen, logs.

The default platform-to-core list is in `config/cores.default.json`, and known BIOS requirements
are in `config/bios.default.json`.

## Where things are stored

Everything lives in `%APPDATA%\romm-launcher` (`~/.config/romm-launcher` on Linux):

| Path                 | Contents                                                         |
| -------------------- | ---------------------------------------------------------------- |
| `settings.json`      | Settings                                                         |
| `credentials.bin`    | Session token, encrypted by the operating system                 |
| `roms/<platform>/`   | Downloaded games (movable in Settings)                           |
| `saves/<platform>/`  | Game saves                                                       |
| `states/<platform>/` | Save states                                                      |
| `save-backups/`      | Backups made before any save was replaced or removed             |
| `covers/`            | Cover art                                                        |
| `sync.db`            | What was last synced, and the remembered library for offline use |
| `logs/launcher.log`  | Log files (five files of 1 MB at most)                           |

Your own RetroArch configuration is not modified. For each session the launcher passes a few
settings on top of it:

- its save and state folders, and the controller assignment;
- quit when content is closed, so you land back in the launcher;
- RetroArch's on-screen touch buttons off (Settings → RetroArch turns them back on);
- RetroArch's own cloud sync off, so two systems do not sync the same saves.

## Troubleshooting

**The game starts but the controller does nothing.**
Open Settings → Controllers. Your controller should be listed as Player 1. If it is listed as
ignored, RetroArch has no profile for it: start RetroArch on its own and update its controller
profiles (Online Updater → Update Controller Profiles), or bind the buttons there once. If it is
not listed at all, connect it and choose "Look for controllers".

**"No core for … is installed."**
Install a core for that platform. Standalone RetroArch: Online Updater → Core Downloader. Steam
version: add the core from RetroArch's DLC list in Steam. Then choose it in Settings → Cores if it
is not picked automatically.

**"… needs a BIOS file."**
Some systems (PlayStation, Saturn, Sega CD, Dreamcast and others) need BIOS files in RetroArch's
`system` folder. The message lists the accepted file names and the folder. "Play anyway" is there
for cores that can run without one.

**"RetroArch was not found."**
Install it, or point the launcher at `retroarch.exe` in Settings → RetroArch.

**A game shows "Not synced" or "Save conflict".**
"Not synced" clears by itself once the server is reachable; "Sync saves" on the game's page tries
immediately. For a conflict, open the game's page and choose which save to keep.

**Collections are empty, or favourites ask me to sign in again.**
Sessions created by an older version of the launcher were not given access to collections.
Sign out from the menu and sign in again.

**I got signed out.**
RomM sessions expire after about a week without use. Sign in again; nothing local is lost.

**A cover is missing or outdated.**
Covers are saved the first time they are shown. Delete the `covers` folder to fetch them again.

**Reporting a problem.**
Settings → This device → "Copy recent log" puts the log on the clipboard. Logs never contain your
password or session token.

## Development

Requires Node 22 or newer.

```bash
npm install
npm run dev
```

| Script                               | What it does                                         |
| ------------------------------------ | ---------------------------------------------------- |
| `npm run dev`                        | Start the app windowed, with hot reload              |
| `npm run build`                      | Build main, preload and renderer into `out/`         |
| `npm test`                           | Unit tests (Vitest; RomM is faked with msw)          |
| `npm run typecheck` / `npm run lint` | Static checks                                        |
| `npm run dist`                       | Build the Windows installer and portable executable  |
| `npm run api:fetch -- <url>`         | Download the OpenAPI spec from a RomM instance       |
| `npm run api:types`                  | Regenerate `src/main/romm/schema.d.ts` from the spec |
| `npm run icon`                       | Regenerate `build/icon.png`                          |

### Building

```bash
npm run dist
```

The installer and the portable executable are written to `dist/`.

### Layout

- `src/main`: everything with file or network access.
  - `romm/`: typed RomM client, sign-in, token refresh, retries.
  - `downloads/`: download queue, verification, multi-file games, cache policy.
  - `launcher/`: RetroArch detection, cores, controllers, BIOS checks, launching.
  - `saves/`: sync decisions, the sync engine, backups, import.
  - `library/`, `settings/`, `logging/`, `ipc/`.
- `src/preload`: the narrow `window.romm` bridge.
- `src/renderer`: the React UI. It has no network or Node access; everything goes through IPC.
  - `input/`: gamepad and keyboard handling and spatial focus navigation.
- `src/shared/ipc.ts`: the contract between the two sides.
- `docs/romm-api-notes.md`: the RomM endpoints the launcher relies on, and how they behave.

Decisions worth knowing about:

- The sync decision (`src/main/saves/syncDecision.ts`) is a pure function of this PC's file, the
  server's file and the record of the last sync. It never compares clocks between machines.
- Local state is in SQLite through Node's built-in `node:sqlite`, so there is no native module to
  rebuild.
- The renderer runs sandboxed with a strict content security policy. Cover images reach it through
  a custom protocol that only serves RomM's asset paths.
