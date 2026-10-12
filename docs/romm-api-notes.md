# RomM API notes

Taken from the OpenAPI spec of a RomM **5.4.0** instance (`docs/romm-openapi.json`).
Refresh with `npm run api:fetch -- <server url>` then `npm run api:types`.

The spec is served at `/openapi.json` (not `/api/openapi.json`); Swagger UI is at `/api/docs`.

## Auth

| Purpose                | Endpoint                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| Log in                 | `POST /api/token`, form-encoded, `grant_type=password`, `username`, `password`, `scope` (space-separated) |
| Refresh                | `POST /api/token`, `grant_type=refresh_token`, `refresh_token`                                            |
| Who am I               | `GET /api/users/me`                                                                                       |
| Reachability / version | `GET /api/heartbeat` (no auth) → `SYSTEM.VERSION`                                                         |

The response has `access_token`, `expires`, and optionally `refresh_token`, `refresh_expires`.
Send `Authorization: Bearer <access_token>`. Scopes the launcher requests are listed in
`src/main/romm/auth.ts`.

Not used yet, but relevant for a gamepad-only setup: the device pairing flow
(`POST /api/auth/device/init` → approve at `/pair/device` in the web UI → poll
`POST /api/auth/device/token`) yields a long-lived, device-bound token without typing a password.

## Library

| Purpose             | Endpoint                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Platforms           | `GET /api/platforms` → `PlatformSchema[]` (not paginated; `rom_count`, `slug`, `fs_slug`, `firmware[]`)          |
| ROM list / search   | `GET /api/roms?platform_ids=&search_term=&order_by=&order_dir=&limit=&offset=` → `{items, total, limit, offset}` |
| ROM detail          | `GET /api/roms/{id}` → `DetailedRomSchema` (adds `user_saves`, `user_states`, `files`)                           |
| Incremental refresh | `updated_after=` on both list endpoints                                                                          |

Pass `with_char_index=false&with_filter_values=false&with_rom_id_index=false` on `/api/roms`;
those extras serve RomM's own web UI. `/api/search/roms` searches metadata providers, not the library.

Covers: `path_cover_small`, `path_cover_large`, `url_cover`. Release date and genres are in `metadatum`.
Per-user play state is in `rom_user` (`last_played`).

## ROM content

| Purpose                      | Endpoint                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------- |
| Download                     | `GET` / `HEAD /api/roms/{id}/content/{file_name}` (`?file_ids=`, `?purpose=play`) |
| One file of a multi-file ROM | `GET /api/roms/{fileId}/files/content/{file_name}`                                |

A single-file ROM is served as-is; a multi-file ROM is served as a zip that includes an `.m3u`
when applicable. ROMs and individual files carry `crc_hash`, `md5_hash`, `sha1_hash`.

## Saves

| Purpose            | Endpoint                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| List               | `GET /api/saves?rom_id=` (also `rom_ids`, `platform_id`, `device_id`, `slot`)                        |
| Per-slot summary   | `GET /api/saves/summary?rom_id=`                                                                     |
| Download           | `GET /api/saves/{id}/content?device_id=`                                                             |
| Upload             | `POST /api/saves?rom_id=&emulator=&slot=&device_id=&content_hash=&overwrite=` (multipart `saveFile`) |
| Replace            | `PUT /api/saves/{id}?device_id=&content_hash=` (multipart `saveFile`)                                |
| Confirm a download | `POST /api/saves/{id}/downloaded` `{device_id, content_hash}`                                        |
| Delete             | `POST /api/saves/delete` `{saves: number[]}`                                                         |

Fields useful for conflict handling: `slot`, `content_hash`, `updated_at`, `origin_device_id`,
`device_syncs[] {device_id, device_name, last_synced_at, is_current}`.

## States

| Purpose  | Endpoint                                                                                |
| -------- | --------------------------------------------------------------------------------------- |
| List     | `GET /api/states?rom_id=`                                                               |
| Download | `GET /api/states/{id}/content`                                                          |
| Upload   | `POST /api/states?rom_id=&emulator=` (multipart `stateFile`, optional `screenshotFile`) |
| Replace  | `PUT /api/states/{id}`                                                                  |
| Delete   | `POST /api/states/delete`                                                               |

States have **no** slot, content hash or device fields (only `emulator`, `core`, `updated_at`),
so their sync state has to be tracked entirely on the client.

## Devices and server-side sync

| Purpose          | Endpoint                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Register this PC | `POST /api/devices` `{name, hostname, platform, client, client_version}` → `device_id`                                                   |
| Negotiate        | `POST /api/sync/negotiate` `{device_id, saves: ClientSaveState[], rom_ids}` → operations `upload / download / conflict / delete / no_op` |
| Finish a session | `POST /api/sync/sessions/{id}/complete`                                                                                                  |

Negotiate pairs saves on `(rom_id, slot)`. A save with a null slot is never paired and always
comes back as `upload`, so the launcher must always send a stable slot name. It covers saves only.

## Also available

- `GET /api/firmware?platform_id=` and `GET /api/firmware/{id}/content/{file_name}`: BIOS files hosted by RomM.
- `POST /api/play-sessions`, `PUT /api/roms/{id}/props?update_last_played=true`: play tracking.

## Verified against a live 5.4.0 server

Found with the "API probe" button on the debug screen (read-only) and an end-to-end launch:

- **Tokens**: the access token lasts about 30 minutes, the refresh token about 7 days. After
  7 days without use the user has to log in again.
- **Covers**: `path_cover_small` is already a server-relative URL
  (`/assets/romm/resources/roms/<platform>/<rom>/cover/small.png?ts=...`). Append it to the
  server URL as-is. It was served without a bearer token.
- **Resume**: ROM downloads honour `Range` (206 with `Content-Range`), although the response
  carries no `Accept-Ranges` header.
- **ROM hash**: `md5_hash` on a single-file ROM is the MD5 of the file as downloaded.
- **Save hash**: `content_hash` on a save is the MD5 of the save file.
