import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addToSteam, getSteamShortcutStatus, type SteamDeps } from '../src/main/steam/addToSteam';
import {
  UnsupportedVdfError,
  hasShortcut,
  mostRecentAccountId,
  parseBinaryVdf,
  serializeBinaryVdf,
  shortcutAppId,
  upsertShortcut,
  type VdfMap,
} from '../src/main/steam/shortcuts';

const EXE = 'C:\\Users\\player\\AppData\\Local\\Programs\\Couchcart\\Couchcart.exe';
const spec = {
  name: 'Couchcart',
  exe: EXE,
  startDir: 'C:\\Users\\player\\AppData\\Local\\Programs\\Couchcart',
  icon: EXE,
};

/** A file as Steam writes it, with one game the user added themselves. */
const otherGame: VdfMap = [
  [
    'shortcuts',
    [
      [
        '0',
        [
          ['appid', -872963361],
          ['AppName', 'Some Other Game'],
          ['Exe', 'D:\\Games\\Other\\other.exe'],
          ['StartDir', 'D:\\Games\\Other\\'],
          ['icon', ''],
          ['LaunchOptions', '-windowed'],
          ['IsHidden', 0],
          ['LastPlayTime', 1791786000],
          ['sortas', ''],
          ['tags', [['0', 'favorite']]],
        ],
      ],
    ],
  ],
];
const field = (entry: unknown, key: string) =>
  (entry as VdfMap).find(([name]) => name === key)?.[1];
const entries = (root: VdfMap) => root[0]?.[1] as VdfMap;

describe('binary VDF', () => {
  it('reads the bytes Steam writes', () => {
    // "shortcuts" { "0" { appid = 1 (int), AppName = "A" } }
    const bytes = Buffer.concat([
      Buffer.from('\x00shortcuts\x00\x000\x00\x02appid\x00', 'latin1'),
      Buffer.from([1, 0, 0, 0]),
      Buffer.from('\x01AppName\x00A\x00\x08\x08\x08', 'latin1'),
    ]);

    expect(parseBinaryVdf(bytes)).toEqual([
      [
        'shortcuts',
        [
          [
            '0',
            [
              ['appid', 1],
              ['AppName', 'A'],
            ],
          ],
        ],
      ],
    ]);
    expect(serializeBinaryVdf(parseBinaryVdf(bytes))).toEqual(bytes);
  });

  it('writes back exactly what it read, including negative ids and non-ASCII names', () => {
    const root: VdfMap = structuredClone(otherGame);
    (entries(root)[0]?.[1] as VdfMap)[1] = ['AppName', 'Pokémon – Edición'];
    const bytes = serializeBinaryVdf(root);

    expect(parseBinaryVdf(bytes)).toEqual(root);
    expect(serializeBinaryVdf(parseBinaryVdf(bytes))).toEqual(bytes);
  });

  it('refuses a value type it does not know rather than guessing', () => {
    const bytes = Buffer.from(
      '\x00shortcuts\x00\x07big\x00\x01\x02\x03\x04\x05\x06\x07\x08\x08\x08',
    );

    expect(() => parseBinaryVdf(bytes)).toThrow(UnsupportedVdfError);
  });

  it('refuses a file that stops halfway', () => {
    const bytes = serializeBinaryVdf(otherGame);

    expect(() => parseBinaryVdf(bytes.subarray(0, bytes.length - 3))).toThrow(UnsupportedVdfError);
    expect(() => parseBinaryVdf(Buffer.concat([bytes, Buffer.from([1])]))).toThrow(
      UnsupportedVdfError,
    );
  });
});

describe('upsertShortcut', () => {
  it('adds the launcher after the existing games and leaves them untouched', () => {
    const root = structuredClone(otherGame);

    const appId = upsertShortcut(root, spec);

    expect(entries(root)).toHaveLength(2);
    expect(entries(root)[0]).toEqual(entries(otherGame)[0]);
    const [key, added] = entries(root)[1] ?? [];
    expect(key).toBe('1');
    expect(field(added, 'AppName')).toBe('Couchcart');
    expect(field(added, 'Exe')).toBe(`"${EXE}"`);
    expect(field(added, 'StartDir')).toBe(`"${spec.startDir}"`);
    expect(field(added, 'AllowOverlay')).toBe(1);
    // The id is stored signed, and used unsigned in artwork file names.
    expect((field(added, 'appid') as number) >>> 0).toBe(appId);
    expect(appId).toBeGreaterThan(0x7fffffff);
  });

  it('starts a list when Steam has no non-Steam games yet', () => {
    const root: VdfMap = [];

    upsertShortcut(root, spec);

    expect(entries(root)).toHaveLength(1);
    expect(entries(root)[0]?.[0]).toBe('0');
  });

  it('updates its own entry instead of adding a second one, keeping the id Steam knows', () => {
    const root = structuredClone(otherGame);
    const first = upsertShortcut(root, spec);

    const again = upsertShortcut(root, { ...spec, name: 'Couchcart', icon: 'new.ico' });

    expect(entries(root)).toHaveLength(2);
    expect(again).toBe(first);
    expect(field(entries(root)[1]?.[1], 'icon')).toBe('new.ico');
  });

  it('recognizes its entry however Steam wrote the path', () => {
    const root: VdfMap = [
      [
        'shortcuts',
        [
          [
            '0',
            [
              ['appid', -5],
              ['AppName', 'My launcher'],
              ['Exe', EXE.toLowerCase().replace(/\\/g, '/')], // no quotes, other slashes and case
            ],
          ],
        ],
      ],
    ];

    expect(hasShortcut(root, EXE)).toBe(true);
    expect(upsertShortcut(root, spec)).toBe(-5 >>> 0);
    expect(entries(root)).toHaveLength(1);
    expect(hasShortcut(otherGame, EXE)).toBe(false);
  });

  it('derives the same id for the same program every time', () => {
    expect(shortcutAppId(spec)).toBe(shortcutAppId({ ...spec }));
    expect(shortcutAppId(spec)).not.toBe(shortcutAppId({ ...spec, name: 'Other' }));
  });
});

describe('mostRecentAccountId', () => {
  const users = (first: string, second: string) => `"users"
{
	"76561198019592336"
	{
		"AccountName"		"one"
		${first}
	}
	"76561197960265729"
	{
		"AccountName"		"two"
		${second}
	}
}`;

  it('picks the account marked as most recent', () => {
    expect(mostRecentAccountId(users('"MostRecent"		"0"', '"MostRecent"		"1"'))).toBe('1');
    expect(mostRecentAccountId(users('"MostRecent"		"1"', '"MostRecent"		"0"'))).toBe('59326608');
  });

  it('takes the only account when none is marked, and gives up when there are several', () => {
    const single = `"users"\n{\n\t"76561198019592336"\n\t{\n\t\t"AccountName"\t\t"one"\n\t}\n}`;

    expect(mostRecentAccountId(single)).toBe('59326608');
    expect(mostRecentAccountId(users('', ''))).toBeNull();
    expect(mostRecentAccountId('')).toBeNull();
  });
});

describe('adding the launcher to Steam', () => {
  let dir: string;
  let running: boolean;
  let deps: SteamDeps;
  const stopSteam = vi.fn(async () => {
    running = false;
  });
  const startSteam = vi.fn();
  const config = () => join(dir, 'Steam', 'userdata', '59326608', 'config');
  const shortcutsFile = () => join(config(), 'shortcuts.vdf');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'couchcart-steam-'));
    running = false;
    stopSteam.mockClear();
    startSteam.mockClear();
    mkdirSync(config(), { recursive: true });
    mkdirSync(join(dir, 'Steam', 'userdata', '0'), { recursive: true });
    const art = join(dir, 'art');
    mkdirSync(art);
    for (const file of ['cover.png', 'wide-cover.png', 'hero.jpg', 'logo.png']) {
      writeFileSync(join(art, file), file);
    }
    deps = {
      findSteamRoots: async () => [join(dir, 'missing'), join(dir, 'Steam')],
      isSteamRunning: async () => running,
      stopSteam,
      startSteam,
      shortcut: spec,
      artworkDir: art,
    };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reports a PC without Steam', async () => {
    const none = { ...deps, findSteamRoots: async () => [join(dir, 'missing')] };

    expect(await getSteamShortcutStatus(none)).toEqual({
      installed: false,
      running: false,
      added: false,
    });
    await expect(addToSteam(none, { restartSteam: false })).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('adds the entry and its artwork, keeping a backup of the file it changed', async () => {
    const before = serializeBinaryVdf(otherGame);
    writeFileSync(shortcutsFile(), before);
    expect(await getSteamShortcutStatus(deps)).toMatchObject({ installed: true, added: false });

    const result = await addToSteam(deps, { restartSteam: false });

    expect(result).toEqual({ installed: true, running: false, added: true });
    const written = parseBinaryVdf(readFileSync(shortcutsFile()));
    expect(entries(written)).toHaveLength(2);
    expect(entries(written)[0]).toEqual(entries(otherGame)[0]);
    expect(readFileSync(`${shortcutsFile()}.couchcart-backup`)).toEqual(before);

    const id = shortcutAppId(spec);
    const grid = join(config(), 'grid');
    expect(readFileSync(join(grid, `${id}p.png`), 'utf8')).toBe('cover.png');
    expect(readFileSync(join(grid, `${id}.png`), 'utf8')).toBe('wide-cover.png');
    expect(readFileSync(join(grid, `${id}_hero.jpg`), 'utf8')).toBe('hero.jpg');
    expect(readFileSync(join(grid, `${id}_logo.png`), 'utf8')).toBe('logo.png');
    expect(await getSteamShortcutStatus(deps)).toMatchObject({ added: true });
    expect(stopSteam).not.toHaveBeenCalled();
    expect(startSteam).not.toHaveBeenCalled();
  });

  it('creates the file when Steam has never had a non-Steam game', async () => {
    await addToSteam(deps, { restartSteam: false });

    expect(entries(parseBinaryVdf(readFileSync(shortcutsFile())))).toHaveLength(1);
    expect(existsSync(`${shortcutsFile()}.couchcart-backup`)).toBe(false);
  });

  it('does not touch anything while Steam is open, unless told to restart it', async () => {
    running = true;

    await expect(addToSteam(deps, { restartSteam: false })).rejects.toMatchObject({
      code: 'busy',
    });
    expect(existsSync(shortcutsFile())).toBe(false);
    expect(stopSteam).not.toHaveBeenCalled();
  });

  it('closes Steam, makes the change and starts Steam again', async () => {
    running = true;

    const result = await addToSteam(deps, { restartSteam: true });

    expect(stopSteam).toHaveBeenCalledWith(join(dir, 'Steam'));
    expect(existsSync(shortcutsFile())).toBe(true);
    expect(startSteam).toHaveBeenCalledWith(join(dir, 'Steam'));
    expect(result).toMatchObject({ added: true, running: true });
  });

  it('leaves a file it does not understand alone, and still restarts Steam', async () => {
    running = true;
    const strange = Buffer.from(
      '\x00shortcuts\x00\x07big\x00\x01\x02\x03\x04\x05\x06\x07\x08\x08\x08',
    );
    writeFileSync(shortcutsFile(), strange);

    await expect(addToSteam(deps, { restartSteam: true })).rejects.toMatchObject({
      code: 'internal',
    });
    expect(readFileSync(shortcutsFile())).toEqual(strange);
    expect(startSteam).toHaveBeenCalled();
  });
});
