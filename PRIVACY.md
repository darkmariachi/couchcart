# Privacy

Couchcart has no accounts of its own, no analytics, no telemetry and no crash reporting. It does
not contact its authors or any service they run.

## What it connects to

- **Your RomM server**, at the address you enter, to sign in, read your library, download games
  and artwork, and upload and download saves. Nothing is sent anywhere else.
- **Your local network, only when you choose "Find my server"** during setup: it asks each nearby
  address on RomM's default port whether it is a RomM server.
- **Steam or retroarch.com, only when you press the button for it**, to open RetroArch's page.
- **libretro's download server (`buildbot.libretro.com`), only when you ask the launcher to set
  up RetroArch or download a core.** It sees what any download shows a server: your IP address
  and which files you fetched. Nothing about you or your library is sent.
- **GitHub (`github.com` and `api.github.com`), to look for a newer version of Couchcart** and,
  for the Windows installer and the AppImage, to download it. This happens shortly after the app
  starts and a few times a day while it is open. GitHub sees your IP address and that a copy of
  Couchcart asked; nothing about you or your library is sent. Turn it off under Settings,
  Updates, "Check automatically"; after that it only happens when you choose "Check for updates".

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
