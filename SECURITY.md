# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use **Security → Report a vulnerability** on this repository
(<https://github.com/darkmariachi/couchcart/security/advisories/new>). The report stays private
between you and the maintainers until a fix is out.

Include what you can of:

- what an attacker could do, and what they would need (a malicious RomM server, a file on disk,
  access to the local network, ...);
- the Couchcart version and operating system;
- steps to reproduce.

This is a spare-time project, so replies may take a few days.

## Supported versions

Only the latest release gets fixes.

## What is in scope

Couchcart talks to a RomM server you choose, stores a session token on your PC, downloads files
and starts RetroArch. Problems worth reporting include:

- a RomM server (or anyone on the network path) writing files outside Couchcart's folders, or
  running code on the PC;
- the session token or password ending up in logs, in plain text on disk, or sent anywhere other
  than your RomM server;
- the app's window loading or running content it should not;
- a download from libretro's server being accepted when it should have been rejected.

Vulnerabilities in RomM, RetroArch or a libretro core belong with those projects.
