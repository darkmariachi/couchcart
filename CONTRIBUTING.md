# Contributing

Thanks for wanting to help. Bug reports, fixes and small improvements are all welcome.

## Reporting a bug

Open an issue with the bug template, with the versions shown on the Account screen. The most
useful thing you can attach is the log: **Settings → This device → Copy recent log**. Logs never contain your password or session token,
but they do contain your server address and game names, so remove anything you would rather not
share.

## Proposing a change

For anything larger than a fix, open an issue first so we can agree on the approach before you
spend time on it. Couchcart is deliberately a launcher and a save-sync client: it does not embed
emulators, and it does not include or link to games, BIOS files or artwork.

## Working on the code

You need Node 22 or newer.

```bash
npm install
npm run dev
```

Before opening a pull request, run what CI runs:

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
```

`npm run format` fixes formatting. The [README](README.md#development) describes the scripts and
how the code is laid out.

A few things to keep in mind:

- **Tests come with the change.** RomM is faked with msw in `tests/helpers/fakeRomm.ts`; nothing
  in the test suite talks to a real server.
- **The renderer has no network or file access.** Anything new it needs goes through the typed
  contract in `src/shared/ipc.ts`, with its input validated in `src/main/ipc/handlers.ts`.
- **Saves are never overwritten silently.** Changes to `src/main/saves` need tests for the case
  where both sides changed.
- **Never log or store a password or token in plain text**, and never commit real server
  responses: they contain account and library details.
- **Trust RomM's API as it is.** Check behaviour against a real server or its OpenAPI spec
  (`npm run api:fetch -- <url>`) rather than guessing an endpoint.

## Licence

By contributing you agree that your work is released under the [MIT licence](LICENSE).
