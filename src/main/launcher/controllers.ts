import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ControllerInfo, GamepadCombo } from '../../shared/ipc';
import { log } from '../logging/logger';
import type { RetroArchInstall } from './retroarch';

const execFileAsync = promisify(execFile);

/** A game controller as RetroArch itself identifies it. */
export interface DetectedController {
  name: string;
  vendorId: string;
  productId: string;
  /** RetroArch has a button layout for it. Devices without one cannot be played with. */
  recognized: boolean;
}

/** The form RetroArch's "reserved device" setting expects: `vid:pid name`. */
export function controllerSignature(controller: DetectedController): string {
  return `${controller.vendorId}:${controller.productId} ${controller.name}`;
}

/**
 * Reads the controllers out of a verbose RetroArch log, in the order RetroArch found them.
 * Example line:
 *   [Autoconf] Config files scanned: driver xinput, pad name Controller (Xbox One For
 *   Windows) (045e/02ff), phys , affinity 50
 * An affinity of 0 means no layout matched, which is how keyboards and other HID devices
 * that merely present themselves as game controllers show up.
 */
export function parseControllerLog(logText: string): DetectedController[] {
  const line =
    /Config files scanned: driver \S+, pad name (.+) \(([0-9a-f]{4})\/([0-9a-f]{4})\), phys .*, affinity (\d+)/gi;
  return [...logText.matchAll(line)].map((match) => ({
    name: match[1] ?? '',
    vendorId: (match[2] ?? '').toLowerCase(),
    productId: (match[3] ?? '').toLowerCase(),
    recognized: Number(match[4]) > 0,
  }));
}

/**
 * Asks RetroArch which controllers it sees, without showing anything: it starts with null
 * video and audio drivers, runs for one frame and exits. Takes several seconds, so callers
 * run it in the background and reuse the result.
 */
export async function probeControllers(
  install: RetroArchInstall,
  workDir: string,
): Promise<DetectedController[]> {
  await mkdir(workDir, { recursive: true });
  const configPath = join(workDir, 'probe.cfg');
  const logPath = join(workDir, 'probe.log');
  await writeFile(
    configPath,
    [
      'video_driver = "null"',
      'audio_driver = "null"',
      'menu_driver = "null"',
      'log_to_file = "false"',
      'config_save_on_exit = "false"',
      '',
    ].join('\n'),
  );
  await rm(logPath, { force: true });

  try {
    await execFileAsync(
      install.executablePath,
      [
        '--menu',
        '--max-frames=1',
        '--verbose',
        `--log-file=${logPath}`,
        `--appendconfig=${configPath}`,
      ],
      { cwd: install.workingDir, windowsHide: true, timeout: 30_000 },
    );
    return parseControllerLog(await readFile(logPath, 'utf8'));
  } catch (error) {
    log.warn('Controller detection failed', error);
    return [];
  }
}

/**
 * Orders the usable controllers into players. Controllers the user ranked come first, in
 * that order; the rest follow in the order RetroArch found them.
 */
export function assignPlayers(
  detected: DetectedController[],
  preferredOrder: string[],
): DetectedController[] {
  const rank = (controller: DetectedController) => {
    const index = preferredOrder.indexOf(controllerSignature(controller));
    return index === -1 ? Infinity : index;
  };
  return detected
    .filter((controller) => controller.recognized)
    .map((controller, position) => ({ controller, position }))
    .sort((a, b) => rank(a.controller) - rank(b.controller) || a.position - b.position)
    .map(({ controller }) => controller);
}

export function toControllerInfo(
  detected: DetectedController[],
  preferredOrder: string[],
): ControllerInfo[] {
  const players = assignPlayers(detected, preferredOrder);
  return detected.map((controller) => {
    const player = players.indexOf(controller);
    return {
      signature: controllerSignature(controller),
      name: controller.name,
      recognized: controller.recognized,
      player: player === -1 ? null : player + 1,
    };
  });
}

// RetroArch's numbering for its fixed set of gamepad combos.
const COMBO_VALUES: Record<Exclude<GamepadCombo, 'keep'>, string> = {
  none: '0',
  l3_r3: '2',
  start_select: '4',
  hold_start: '7',
  hold_select: '8',
};

const MAX_PLAYERS = 8;

/**
 * RetroArch settings that put each usable controller on a player port.
 *
 * Left alone, RetroArch hands out ports in device order, so a keyboard that reports itself
 * as a game controller can occupy player 1 and leave the real controller on player 2,
 * where a single-player game never looks. Reserving the ports for the recognized
 * controllers avoids that. With nothing detected, port assignment is left to RetroArch.
 */
export function buildControllerSettings(
  players: DetectedController[],
  combos: { menu: GamepadCombo; quit: GamepadCombo },
): Record<string, string> {
  const settings: Record<string, string> = {};

  if (players.length > 0) {
    for (let port = 1; port <= MAX_PLAYERS; port++) {
      const controller = players[port - 1];
      settings[`input_player${port}_device_reservation_type`] = controller ? '2' : '0';
      settings[`input_player${port}_reserved_device`] = controller
        ? controllerSignature(controller)
        : '';
    }
  }

  if (combos.menu !== 'keep') {
    settings['input_menu_toggle_gamepad_combo'] = COMBO_VALUES[combos.menu];
  }
  if (combos.quit !== 'keep') {
    settings['input_quit_gamepad_combo'] = COMBO_VALUES[combos.quit];
  }
  return settings;
}

/**
 * Keeps an up-to-date list of controllers without making launches wait for a new probe.
 */
export class ControllerDetector {
  private latest: DetectedController[] = [];
  private hasResult = false;
  private running: Promise<DetectedController[]> | null = null;

  constructor(
    private readonly locate: () => Promise<RetroArchInstall | null>,
    private readonly workDir: string,
    private readonly probe: typeof probeControllers = probeControllers,
  ) {}

  /** Starts a detection unless one is already under way, and resolves with its result. */
  refresh(): Promise<DetectedController[]> {
    this.running ??= this.detect().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /**
   * The newest known list. Answers at once when a detection has completed before, so a
   * launch is never held up by a re-check; only the very first detection is waited for.
   */
  current(): Promise<DetectedController[]> {
    if (!this.hasResult && this.running) return this.running;
    return Promise.resolve(this.latest);
  }

  private async detect(): Promise<DetectedController[]> {
    const install = await this.locate();
    if (!install) return this.latest;
    this.latest = await this.probe(install, this.workDir);
    this.hasResult = true;
    log.info(
      `Controllers: ${this.latest.map((c) => `${c.name}${c.recognized ? '' : ' (ignored)'}`).join(', ') || 'none'}`,
    );
    return this.latest;
  }
}
