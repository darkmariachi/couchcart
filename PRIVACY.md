# Privacy

Couchcart has no accounts of its own, no analytics, no telemetry and no crash reporting. It does
not contact its authors or any service they run.

## What it connects to

- **Your RomM server**, at the address you enter, to sign in, read your library, download games
  and artwork, and upload and download saves. Nothing is sent anywhere else.
- **Your local network, only when you choose "Find my server"** during setup: it asks each nearby
  address on RomM's default port whether it is a RomM server.
- **Steam or retroarch.com, only when you press the button for it**, to open RetroArch's page.

## What it stores on your computer

Everything is kept in the app's data folder (`%APPDATA%\couchcart` on Windows):

- Your settings, including the server address and your RomM username.
- A session token for your RomM server, encrypted by the operating system. Your password is never
  stored.
- Downloaded games, saves, save states, backups of replaced saves, cover art, and a copy of your
  library list so the app works offline.
- Log files. They never contain your password or session token.

Removing that folder removes all of it. Your saves on the RomM server are not affected.

## What your RomM server learns

Your RomM server sees what any RomM client would show it: your sign-in, which games you download
and play, your saves, and this computer's name as a device. Who can see that is up to whoever runs
the server.

## RetroArch

Games run in RetroArch, a separate program with its own settings and privacy behaviour. While a
game started from Couchcart is running, RetroArch's own cloud sync is turned off so that only one
system handles your saves.
