import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CacheKeepMode,
  FolderSetting,
  GamepadCombo,
  SettingsPatch,
  SettingsView,
} from '../../shared/ipc';
import { errorMessage, unwrap } from '../api';
import { Focusable } from '../components/Focusable';
import { OnScreenKeyboard } from '../components/OnScreenKeyboard';
import { Screen } from '../components/Screen';
import ui from '../components/ui.module.css';
import { formatSize, nextOption, shortCoreName } from '../format';
import { useControllers, useSettings } from '../hooks';
import { useControls } from '../input/controls';
import { useUi } from '../store/ui';

const COMBO_LABELS: Record<GamepadCombo, string> = {
  keep: "RetroArch's own setting",
  hold_start: 'Hold Start for 2 seconds',
  hold_select: 'Hold Select for 2 seconds',
  start_select: 'Start + Select',
  l3_r3: 'Press both sticks (L3 + R3)',
  none: 'Off',
};
const COMBOS = Object.keys(COMBO_LABELS) as GamepadCombo[];

const KEEP_LABELS: Record<CacheKeepMode, string> = {
  limit: 'Until the size limit is reached',
  always: 'Always',
  never: 'Never (download every time)',
};
const KEEP_MODES = Object.keys(KEEP_LABELS) as CacheKeepMode[];
const CACHE_LIMITS_GB = [5, 10, 20, 50, 100, 250, 500];
const BACKUP_COUNTS = [5, 10, 20, 50];

export function SettingsScreen() {
  const pop = useUi((state) => state.pop);
  const queryClient = useQueryClient();
  const settings = useSettings();
  useControls({ back: { label: 'Back', run: pop } }, { level: 10 });

  const apply = (view: SettingsView) => queryClient.setQueryData(['settings'], view);
  const update = useMutation({
    mutationFn: (patch: SettingsPatch) => unwrap(window.romm.settings.update(patch)),
    onSuccess: (view) => {
      apply(view);
      // Core and cache settings change what the library screens show.
      void queryClient.invalidateQueries({ queryKey: ['library'] });
    },
  });
  const choosePath = useMutation({
    mutationFn: (setting: FolderSetting) => unwrap(window.romm.settings.choosePath(setting)),
    onSuccess: apply,
  });

  const view = settings.data;
  return (
    <Screen title="Settings" ready={settings.isSuccess}>
      {settings.isPending && <p className={ui.muted}>Loading…</p>}
      {settings.isError && <p className={ui.error}>{errorMessage(settings.error)}</p>}
      {update.isError && <p className={ui.error}>{errorMessage(update.error)}</p>}
      {view && (
        <>
          <ControllerSettings view={view} onUpdate={update.mutate} />
          <Group title="RetroArch">
            <Row
              label="RetroArch program"
              value={
                view.retroarch.detectedPath
                  ? `${view.retroarch.detectedPath} (${view.retroarch.version})`
                  : 'Not found'
              }
              onPress={() => choosePath.mutate('retroarch')}
            />
            {view.retroarch.configuredPath && (
              <Row
                label="Find RetroArch automatically"
                value="Currently set by hand"
                onPress={() => update.mutate({ retroarchPath: null })}
              />
            )}
            <Row
              label="Cores folder"
              value={view.retroarch.coresDir ?? 'Not found'}
              onPress={() => choosePath.mutate('cores')}
            />
            {view.retroarch.configuredCoresDir && (
              <Row
                label="Use RetroArch's own cores folder"
                value="Currently set by hand"
                onPress={() => update.mutate({ coresDir: null })}
              />
            )}
            <Row
              label="Start games fullscreen"
              value={view.retroarch.fullscreen ? 'On' : 'Off'}
              onPress={() => update.mutate({ retroarchFullscreen: !view.retroarch.fullscreen })}
            />
            <Row
              label="On-screen touch buttons"
              value={view.retroarch.hideTouchOverlay ? 'Hidden' : "RetroArch's own setting"}
              onPress={() => update.mutate({ hideTouchOverlay: !view.retroarch.hideTouchOverlay })}
            />
            <TextRow
              label="Extra launch options"
              value={view.retroarch.extraArgs}
              placeholder="None"
              onChange={(retroarchExtraArgs) => update.mutate({ retroarchExtraArgs })}
            />
            <p className={ui.note}>
              Choosing a program or folder opens a window that needs a mouse.
            </p>
          </Group>

          <Group title="Cores">
            {view.platformCores.length === 0 && (
              <p className={ui.note}>Platforms appear here once the library has loaded.</p>
            )}
            {view.platformCores.map((platform) => {
              // null stands for "no override": the launcher picks the first installed default.
              const choices: (string | null)[] = [null, ...platform.options];
              return (
                <Row
                  key={platform.slug}
                  label={platform.name}
                  value={
                    platform.core
                      ? `${shortCoreName(platform.core)}${platform.override ? '' : ' (automatic)'}`
                      : 'No core installed'
                  }
                  disabled={platform.options.length === 0}
                  onPress={() =>
                    update.mutate({
                      platformCore: {
                        slug: platform.slug,
                        core: nextOption(choices, platform.override),
                      },
                    })
                  }
                />
              );
            })}
            <p className={ui.note}>A single game can use a different core from its own page.</p>
          </Group>

          <Group title="Storage">
            <Row
              label="Games folder"
              value={view.cache.dir}
              onPress={() => choosePath.mutate('cache')}
            />
            <Row
              label="Keep downloaded games"
              value={KEEP_LABELS[view.cache.keep]}
              onPress={() => update.mutate({ cacheKeep: nextOption(KEEP_MODES, view.cache.keep) })}
            />
            {view.cache.keep === 'limit' && (
              <Row
                label="Size limit"
                value={`${view.cache.limitGb} GB`}
                onPress={() =>
                  update.mutate({ cacheLimitGb: nextOption(CACHE_LIMITS_GB, view.cache.limitGb) })
                }
              />
            )}
            <p className={ui.note}>
              Using {formatSize(view.cache.usedBytes)}
              {view.cache.freeBytes !== null && `, ${formatSize(view.cache.freeBytes)} free`}. When
              the limit is reached, the games you have not played for longest are removed. Saves are
              never removed.
            </p>
          </Group>

          <SaveSettings view={view} onUpdate={update.mutate} />

          <Group title="This device">
            <TextRow
              label="Device name"
              value={view.deviceName}
              onChange={(deviceName) => update.mutate({ deviceName })}
            />
            <Row
              label="Start the launcher fullscreen"
              value={view.launcherFullscreen ? 'On' : 'Off'}
              onPress={() => update.mutate({ launcherFullscreen: !view.launcherFullscreen })}
            />
            <LogRows />
            <p className={ui.note}>
              Signed in to {view.serverUrl ?? 'no server'} as {view.username ?? 'nobody'}. Sign out
              from the menu.
            </p>
          </Group>
        </>
      )}
    </Screen>
  );
}

function ControllerSettings(props: {
  view: SettingsView;
  onUpdate: (patch: SettingsPatch) => void;
}) {
  const queryClient = useQueryClient();
  const controllers = useControllers();
  const detect = useMutation({
    mutationFn: () => unwrap(window.romm.controllers.detect()),
    onSuccess: (list) => queryClient.setQueryData(['controllers'], list),
  });
  const makeFirst = useMutation({
    mutationFn: (signature: string) => unwrap(window.romm.controllers.setPlayerOne(signature)),
    onSuccess: (list) => queryClient.setQueryData(['controllers'], list),
  });

  const { controllers: combos } = props.view;
  const players = (controllers.data ?? [])
    .filter((controller) => controller.player !== null)
    .sort((a, b) => (a.player ?? 0) - (b.player ?? 0));
  const ignored = (controllers.data ?? []).filter((controller) => controller.player === null);

  return (
    <Group title="Controllers">
      {players.map((controller, index) => (
        <Row
          key={`${controller.signature}-${index}`}
          label={`Player ${controller.player}`}
          value={controller.name}
          hint={controller.player === 1 ? undefined : 'Press A to make player 1'}
          onPress={() => makeFirst.mutate(controller.signature)}
        />
      ))}
      {controllers.isSuccess && players.length === 0 && (
        <p className={ui.note}>
          RetroArch did not recognise a controller. Connect one and choose “Look for controllers”.
        </p>
      )}
      <Row
        label="Look for controllers"
        value={detect.isPending ? 'Looking… (a few seconds)' : ''}
        disabled={detect.isPending}
        onPress={() => detect.mutate()}
      />
      {ignored.length > 0 && (
        <p className={ui.note}>
          Ignored because RetroArch has no button layout for them:{' '}
          {ignored.map((controller) => controller.name).join(', ')}.
        </p>
      )}
      <Row
        label="Open the RetroArch menu in a game"
        value={COMBO_LABELS[combos.menuCombo]}
        onPress={() => props.onUpdate({ menuCombo: nextOption(COMBOS, combos.menuCombo) })}
      />
      <Row
        label="Quit a game"
        value={
          combos.quitCombo === 'keep' ? 'From the RetroArch menu' : COMBO_LABELS[combos.quitCombo]
        }
        onPress={() => props.onUpdate({ quitCombo: nextOption(COMBOS, combos.quitCombo) })}
      />
      <p className={ui.note}>
        Button layouts and per-game remapping are changed inside RetroArch: open its menu while a
        game is running and go to Controls. Connected controllers become players in the order shown
        here.
      </p>
    </Group>
  );
}

function SaveSettings(props: { view: SettingsView; onUpdate: (patch: SettingsPatch) => void }) {
  const queryClient = useQueryClient();
  const syncAll = useMutation({
    mutationFn: () => unwrap(window.romm.saves.syncAll()),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['library'] }),
  });
  const importSaves = useMutation({ mutationFn: () => unwrap(window.romm.setup.importSaves()) });

  const syncResult = syncAll.data
    ? `${syncAll.data.synced} of ${syncAll.data.games} games in sync` +
      (syncAll.data.conflicts ? `, ${syncAll.data.conflicts} need a choice` : '') +
      (syncAll.data.failed ? `, ${syncAll.data.failed} could not sync` : '')
    : '';

  return (
    <Group title="Saves">
      <Row
        label="Sync all saves now"
        value={syncAll.isPending ? 'Syncing…' : syncResult}
        disabled={syncAll.isPending}
        onPress={() => syncAll.mutate()}
      />
      <Row
        label="Import saves from RetroArch"
        value={
          importSaves.isPending
            ? 'Looking…'
            : importSaves.isSuccess
              ? `Imported ${importSaves.data} file${importSaves.data === 1 ? '' : 's'}`
              : ''
        }
        disabled={importSaves.isPending}
        onPress={() => importSaves.mutate()}
      />
      <Row
        label="Backups kept per game"
        value={String(props.view.saveBackupCount)}
        onPress={() =>
          props.onUpdate({ saveBackupCount: nextOption(BACKUP_COUNTS, props.view.saveBackupCount) })
        }
      />
      {syncAll.isError && <p className={ui.error}>{errorMessage(syncAll.error)}</p>}
      {importSaves.isError && <p className={ui.error}>{errorMessage(importSaves.error)}</p>}
      <p className={ui.note}>
        Importing copies saves RetroArch made on its own for games in your library. Nothing that
        already exists is overwritten.
      </p>
    </Group>
  );
}

function LogRows() {
  const copy = useMutation({ mutationFn: () => unwrap(window.romm.app.copyLogs()) });
  return (
    <>
      <Row
        label="Copy recent log"
        value={copy.isSuccess ? `${copy.data} lines copied to the clipboard` : ''}
        onPress={() => copy.mutate()}
      />
      <Row
        label="Open the logs folder"
        value=""
        onPress={() => void window.romm.app.openLogsFolder()}
      />
    </>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={ui.rowGroup}>
      <h2 className={ui.rowGroupTitle}>{title}</h2>
      {children}
    </section>
  );
}

function Row(props: {
  label: string;
  value: string;
  hint?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Focusable
      className={ui.settingRow}
      focusKey={`setting-${props.label}`}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <span>
        {props.label}
        {props.hint && <span className={ui.muted}> · {props.hint}</span>}
      </span>
      <span className={ui.settingValue}>{props.value}</span>
    </Focusable>
  );
}

/** A row whose value is typed with the on-screen keyboard. */
function TextRow(props: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <Row
        label={props.label}
        value={props.value || props.placeholder || ''}
        onPress={() => setEditing(true)}
      />
      {editing && (
        <OnScreenKeyboard
          title={props.label}
          initialValue={props.value}
          onCancel={() => setEditing(false)}
          onSubmit={(value) => {
            setEditing(false);
            props.onChange(value);
          }}
        />
      )}
    </>
  );
}
