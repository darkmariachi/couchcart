// Writes THIRD_PARTY_NOTICES.md: the licences of the software shipped inside the app.
// Run it again whenever a bundled dependency is added or updated: npm run notices
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Packages whose code ends up in the built app. Build and test tools are not shipped.
const BUNDLED = [
  'react',
  'react-dom',
  'scheduler',
  '@tanstack/react-query',
  '@tanstack/query-core',
  'zustand',
  'zod',
  'openapi-fetch',
  'openapi-typescript-helpers',
  '@mdi/js',
  'electron',
  // The self-updater and what it is built on.
  'electron-updater',
  'builder-util-runtime',
  'fs-extra',
  'graceful-fs',
  'jsonfile',
  'universalify',
  'js-yaml',
  'argparse',
  'lazy-val',
  'lodash.escaperegexp',
  'lodash.isequal',
  'semver',
  'tiny-typed-emitter',
  'debug',
  'ms',
  'sax',
  // Ships the 7-Zip program (7za) that unpacks downloads; see the note in the header.
  '7zip-bin',
];

function licenceText(dir) {
  const file = readdirSync(dir).find((name) => /^licen[cs]e(\.md|\.txt)?$/i.test(name));
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null;
}

const sections = [];
for (const name of BUNDLED) {
  const dir = join('node_modules', name);
  if (!existsSync(dir)) {
    console.error(`Missing ${name}: run npm install first.`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const repository =
    typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  sections.push(
    [
      `## ${name} ${manifest.version}`,
      '',
      `Licence: ${manifest.license ?? 'see below'}`,
      repository ? `Source: ${repository.replace(/^git\+/, '').replace(/\.git$/, '')}` : null,
      '',
      '```',
      licenceText(dir) ?? `No licence file is included in the package; see its repository.`,
      '```',
    ]
      .filter((line) => line !== null)
      .join('\n'),
  );
}

const header = `# Third-party notices

Couchcart includes the software listed below. Each is the property of its authors and is used
under the licence shown.

Electron also contains Chromium and other components; their notices ship with the app as
\`LICENSES.chromium.html\`, next to the executable.

The app also ships the 7-Zip command-line program (7za), Copyright (C) Igor Pavlov, used to
unpack downloads. 7-Zip is licensed under the GNU LGPL, with a BSD 3-clause licence for parts of
its code; the program is unmodified and its source is available from https://www.7-zip.org.

Couchcart does not include RetroArch, any libretro core, or RomM. It starts a RetroArch that you
installed yourself, or that it downloaded from libretro at your request, and talks to a RomM
server that you run. Game artwork and platform icons are
loaded from your RomM server and are not part of Couchcart.
`;

writeFileSync('THIRD_PARTY_NOTICES.md', `${header}\n${sections.join('\n\n')}\n`);
console.log(`Wrote THIRD_PARTY_NOTICES.md (${BUNDLED.length} packages)`);
