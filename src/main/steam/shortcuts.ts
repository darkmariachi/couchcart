import { crc32 } from 'node:zlib';

/**
 * Steam keeps the non-Steam games a user added in `shortcuts.vdf`, in its binary key-value
 * format: each entry is a type byte, a zero-terminated key, and a value. Valve does not
 * document the file, so anything not understood here makes the launcher refuse to touch
 * it rather than risk damaging it.
 */
const TYPE_MAP = 0x00;
const TYPE_STRING = 0x01;
const TYPE_INT = 0x02;
const END = 0x08;

export type VdfValue = string | number | VdfMap;
/** Entries in file order, which is preserved when writing. */
export type VdfMap = [key: string, value: VdfValue][];

export class UnsupportedVdfError extends Error {}

export function parseBinaryVdf(data: Buffer): VdfMap {
  let offset = 0;

  const readString = (): string => {
    const end = data.indexOf(0, offset);
    if (end < 0) throw new UnsupportedVdfError('A text value has no end.');
    const text = data.toString('utf8', offset, end);
    offset = end + 1;
    return text;
  };

  const readMap = (): VdfMap => {
    const map: VdfMap = [];
    for (;;) {
      if (offset >= data.length) throw new UnsupportedVdfError('The file ends early.');
      const type = data[offset++];
      if (type === END) return map;
      const key = readString();
      if (type === TYPE_MAP) {
        map.push([key, readMap()]);
      } else if (type === TYPE_STRING) {
        map.push([key, readString()]);
      } else if (type === TYPE_INT) {
        if (offset + 4 > data.length) throw new UnsupportedVdfError('The file ends early.');
        map.push([key, data.readInt32LE(offset)]);
        offset += 4;
      } else {
        throw new UnsupportedVdfError(`Unknown value type ${type}.`);
      }
    }
  };

  const root = readMap();
  if (offset !== data.length) throw new UnsupportedVdfError('Unexpected data after the end.');
  return root;
}

export function serializeBinaryVdf(root: VdfMap): Buffer {
  const parts: Buffer[] = [];
  const text = (value: string) => parts.push(Buffer.from(`${value}\0`, 'utf8'));

  const writeMap = (map: VdfMap) => {
    for (const [key, value] of map) {
      if (typeof value === 'string') {
        parts.push(Buffer.from([TYPE_STRING]));
        text(key);
        text(value);
      } else if (typeof value === 'number') {
        parts.push(Buffer.from([TYPE_INT]));
        text(key);
        const number = Buffer.alloc(4);
        number.writeInt32LE(value | 0);
        parts.push(number);
      } else {
        parts.push(Buffer.from([TYPE_MAP]));
        text(key);
        writeMap(value);
      }
    }
    parts.push(Buffer.from([END]));
  };

  writeMap(root);
  return Buffer.concat(parts);
}

export interface ShortcutSpec {
  name: string;
  /** Full path of the program. */
  exe: string;
  startDir: string;
  /** Path of an image or program to take the icon from; empty for none. */
  icon: string;
}

const get = (map: VdfMap, key: string): VdfValue | undefined =>
  map.find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1];

const set = (map: VdfMap, key: string, value: VdfValue): void => {
  const entry = map.find(([name]) => name.toLowerCase() === key.toLowerCase());
  if (entry) entry[1] = value;
  else map.push([key, value]);
};

const unquote = (value: string) => value.replace(/^"(.*)"$/, '$1');
const quote = (value: string) => `"${unquote(value)}"`;
const samePath = (a: string, b: string) =>
  unquote(a).replace(/\\/g, '/').toLowerCase() === unquote(b).replace(/\\/g, '/').toLowerCase();

/** The id Steam files artwork under, as it appears in file names (unsigned). */
export function shortcutAppId(spec: Pick<ShortcutSpec, 'exe' | 'name'>): number {
  // Any id with the top bit set is valid for a shortcut; deriving it from the program and
  // name keeps it the same if the entry is ever recreated.
  return (crc32(`${quote(spec.exe)}${spec.name}`) | 0x80000000) >>> 0;
}

/**
 * Adds the shortcut to the parsed file, or brings an existing entry for the same program
 * up to date. Other shortcuts are left exactly as they were. Returns the artwork id.
 */
export function upsertShortcut(root: VdfMap, spec: ShortcutSpec): number {
  let shortcuts = get(root, 'shortcuts');
  if (shortcuts === undefined) {
    shortcuts = [];
    root.push(['shortcuts', shortcuts]);
  }
  if (!Array.isArray(shortcuts)) throw new UnsupportedVdfError('"shortcuts" is not a list.');

  for (const [, entry] of shortcuts) {
    if (!Array.isArray(entry)) continue;
    const exe = get(entry, 'Exe');
    if (typeof exe !== 'string' || !samePath(exe, spec.exe)) continue;

    set(entry, 'AppName', spec.name);
    set(entry, 'StartDir', quote(spec.startDir));
    set(entry, 'icon', spec.icon);
    const existing = get(entry, 'appid');
    if (typeof existing === 'number') return existing >>> 0;
    const appId = shortcutAppId(spec);
    entry.unshift(['appid', appId | 0]);
    return appId;
  }

  const appId = shortcutAppId(spec);
  const used = shortcuts.map(([key]) => Number(key)).filter(Number.isInteger);
  const index = used.length > 0 ? Math.max(...used) + 1 : 0;
  shortcuts.push([
    String(index),
    [
      ['appid', appId | 0],
      ['AppName', spec.name],
      ['Exe', quote(spec.exe)],
      ['StartDir', quote(spec.startDir)],
      ['icon', spec.icon],
      ['ShortcutPath', ''],
      ['LaunchOptions', ''],
      ['IsHidden', 0],
      ['AllowDesktopConfig', 1],
      ['AllowOverlay', 1],
      ['OpenVR', 0],
      ['Devkit', 0],
      ['DevkitGameID', ''],
      ['DevkitOverrideAppID', 0],
      ['LastPlayTime', 0],
      ['FlatpakAppID', ''],
      ['tags', []],
    ],
  ]);
  return appId;
}

/** Whether the file already has an entry for this program. */
export function hasShortcut(root: VdfMap, exe: string): boolean {
  const shortcuts = get(root, 'shortcuts');
  if (!Array.isArray(shortcuts)) return false;
  return shortcuts.some(([, entry]) => {
    const value = Array.isArray(entry) ? get(entry, 'Exe') : undefined;
    return typeof value === 'string' && samePath(value, exe);
  });
}

/** The account that signed in to Steam last, as the folder name under `userdata`. */
export function mostRecentAccountId(loginUsersVdf: string): string | null {
  const users = [...loginUsersVdf.matchAll(/"(7656\d{13})"\s*\{([^}]*)\}/g)];
  const recent = users.find(([, , body]) => /"MostRecent"\s+"1"/i.test(body ?? '')) ?? null;
  const chosen = recent ?? (users.length === 1 ? users[0] : null);
  if (!chosen?.[1]) return null;
  // The folder is named after the low 32 bits of the 64-bit Steam id.
  return String(BigInt(chosen[1]) & 0xffffffffn);
}
