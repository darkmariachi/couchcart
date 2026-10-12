import { describe, expect, it, vi } from 'vitest';
import {
  ControllerDetector,
  assignPlayers,
  buildControllerSettings,
  controllerSignature,
  parseControllerLog,
  toControllerInfo,
  type DetectedController,
} from '../src/main/launcher/controllers';
import type { RetroArchInstall } from '../src/main/launcher/retroarch';

// Taken from a real RetroArch 1.22 log: a keyboard that presents itself as a game
// controller is found before the actual Xbox controller.
const LOG = `
[INFO] [Input] Found joypad driver: "xinput".
[DEBUG] [Autoconf] Config files scanned: driver dinput, pad name Keychron K10 HE (3434/0ea0), phys , affinity 0
[INFO] [Autoconf] Keychron K10 HE (13364/3744) not configured.
[DEBUG] [Autoconf] Config files scanned: driver xinput, pad name Controller (Xbox One For Windows) (045e/02ff), phys , affinity 50
[INFO] [Autoconf] Xbox One Controller configured in port 2.
`;

const keyboard: DetectedController = {
  name: 'Keychron K10 HE',
  vendorId: '3434',
  productId: '0ea0',
  recognized: false,
};
const xbox: DetectedController = {
  name: 'Controller (Xbox One For Windows)',
  vendorId: '045e',
  productId: '02ff',
  recognized: true,
};
const dualsense: DetectedController = {
  name: 'DualSense Wireless Controller',
  vendorId: '054c',
  productId: '0ce6',
  recognized: true,
};
const combos = { menu: 'keep', quit: 'keep' } as const;

describe('parseControllerLog', () => {
  it('reads each device with its ids and whether RetroArch has a layout for it', () => {
    expect(parseControllerLog(LOG)).toEqual([keyboard, xbox]);
  });

  it('keeps parentheses that are part of the device name', () => {
    expect(parseControllerLog(LOG)[1]?.name).toBe('Controller (Xbox One For Windows)');
  });

  it('returns nothing for a log without controllers', () => {
    expect(parseControllerLog('[INFO] [Input] Found joypad driver: "xinput".')).toEqual([]);
  });
});

describe('assigning players', () => {
  it('skips devices RetroArch cannot use, so a real controller becomes player 1', () => {
    expect(assignPlayers([keyboard, xbox], [])).toEqual([xbox]);
    expect(toControllerInfo([keyboard, xbox], [])).toEqual([
      {
        signature: '3434:0ea0 Keychron K10 HE',
        name: keyboard.name,
        recognized: false,
        player: null,
      },
      {
        signature: '045e:02ff Controller (Xbox One For Windows)',
        name: xbox.name,
        recognized: true,
        player: 1,
      },
    ]);
  });

  it('follows detection order by default', () => {
    expect(assignPlayers([xbox, dualsense], [])).toEqual([xbox, dualsense]);
  });

  it('puts the controller the user chose first', () => {
    const order = [controllerSignature(dualsense)];

    expect(assignPlayers([xbox, dualsense], order)).toEqual([dualsense, xbox]);
  });

  it('ignores a preferred controller that is not connected', () => {
    expect(assignPlayers([xbox], [controllerSignature(dualsense)])).toEqual([xbox]);
  });

  it('gives two identical controllers consecutive players', () => {
    expect(assignPlayers([xbox, keyboard, xbox], []).length).toBe(2);
  });
});

describe('buildControllerSettings', () => {
  it('reserves player 1 for the controller and clears the remaining ports', () => {
    const settings = buildControllerSettings([xbox], combos);

    expect(settings['input_player1_device_reservation_type']).toBe('2');
    expect(settings['input_player1_reserved_device']).toBe(
      '045e:02ff Controller (Xbox One For Windows)',
    );
    expect(settings['input_player2_device_reservation_type']).toBe('0');
    expect(settings['input_player2_reserved_device']).toBe('');
    expect(settings['input_player8_device_reservation_type']).toBe('0');
  });

  it('reserves one port per controller in player order', () => {
    const settings = buildControllerSettings([dualsense, xbox], combos);

    expect(settings['input_player1_reserved_device']).toContain('DualSense');
    expect(settings['input_player2_reserved_device']).toContain('Xbox One');
  });

  it('leaves port assignment to RetroArch when nothing was detected', () => {
    expect(buildControllerSettings([], combos)).toEqual({});
  });

  it('sets the menu and quit combos only when asked to', () => {
    expect(buildControllerSettings([], { menu: 'hold_start', quit: 'keep' })).toEqual({
      input_menu_toggle_gamepad_combo: '7',
    });
    expect(buildControllerSettings([], { menu: 'l3_r3', quit: 'start_select' })).toEqual({
      input_menu_toggle_gamepad_combo: '2',
      input_quit_gamepad_combo: '4',
    });
    expect(buildControllerSettings([], { menu: 'none', quit: 'hold_select' })).toEqual({
      input_menu_toggle_gamepad_combo: '0',
      input_quit_gamepad_combo: '8',
    });
  });
});

describe('ControllerDetector', () => {
  const install = { executablePath: '/ra/retroarch', workingDir: '/ra' } as RetroArchInstall;

  it('waits for the first detection and runs one at a time', async () => {
    let finish: (controllers: DetectedController[]) => void = () => {};
    const probe = vi.fn(() => new Promise<DetectedController[]>((resolve) => (finish = resolve)));
    const detector = new ControllerDetector(async () => install, '/tmp/work', probe);

    expect(await detector.current()).toEqual([]);

    const first = detector.refresh();
    const second = detector.refresh();
    const whileRunning = detector.current();
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
    finish([xbox]);

    expect(await first).toEqual([xbox]);
    expect(await second).toEqual([xbox]);
    expect(await whileRunning).toEqual([xbox]); // the first launch waits for the first result
    expect(await detector.current()).toEqual([xbox]);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('answers from the previous result while a re-check is running', async () => {
    let finish: (controllers: DetectedController[]) => void = () => {};
    const probe = vi
      .fn<() => Promise<DetectedController[]>>()
      .mockResolvedValueOnce([xbox])
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const detector = new ControllerDetector(async () => install, '/tmp/work', probe);
    await detector.refresh();

    const recheck = detector.refresh();

    expect(await detector.current()).toEqual([xbox]);
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
    finish([xbox, dualsense]);
    await recheck;
    expect(await detector.current()).toEqual([xbox, dualsense]);
  });

  it('keeps the previous result when RetroArch is not installed', async () => {
    const probe = vi.fn(async () => [xbox]);
    let found: RetroArchInstall | null = install;
    const detector = new ControllerDetector(async () => found, '/tmp/work', probe);
    await detector.refresh();

    found = null;

    expect(await detector.refresh()).toEqual([xbox]);
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
