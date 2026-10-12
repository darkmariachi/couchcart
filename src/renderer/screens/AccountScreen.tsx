import { useCallback, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mdiController, mdiExitToApp, mdiLogout, mdiTextBoxOutline } from '@mdi/js';
import { errorMessage, unwrap } from '../api';
import { ControllerTest } from '../components/ControllerTest';
import { Focusable } from '../components/Focusable';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import ui from '../components/ui.module.css';
import { formatSize, formatWhen } from '../format';
import { useControls } from '../input/controls';
import { useUi } from '../store/ui';
import styles from './screens.module.css';

/** The parts of RomM's user menu that are useful from the couch. */
export function AccountScreen() {
  const { pop, reset } = useUi();
  const queryClient = useQueryClient();
  const [testing, setTesting] = useState(false);
  const closeTest = useCallback(() => setTesting(false), []);

  const overview = useQuery({
    queryKey: ['account'],
    queryFn: () => unwrap(window.romm.account.overview()),
    staleTime: 0,
  });
  const copyLogs = useMutation({ mutationFn: () => unwrap(window.romm.app.copyLogs()) });
  const signOut = useMutation({
    mutationFn: () => unwrap(window.romm.auth.logout()),
    onSuccess: (status) => {
      reset();
      queryClient.clear();
      queryClient.setQueryData(['auth'], status);
    },
  });

  useControls({ back: { label: 'Home', run: pop } }, { level: 10 });

  const account = overview.data;
  return (
    <Screen
      title={account?.username ?? 'Account'}
      subtitle={account?.role === 'admin' ? 'Admin' : undefined}
      ready={overview.isSuccess}
    >
      {overview.isPending && <p className={ui.muted}>Loading…</p>}
      {overview.isError && <p className={ui.error}>{errorMessage(overview.error)}</p>}

      <div className={styles.toolbar}>
        <Focusable variant="button" preferred onPress={() => setTesting(true)}>
          <Icon path={mdiController} />
          Controller test
        </Focusable>
        <Focusable variant="button" onPress={() => copyLogs.mutate()}>
          <Icon path={mdiTextBoxOutline} />
          {copyLogs.isSuccess ? `Copied ${copyLogs.data} log lines` : 'Copy recent log'}
        </Focusable>
        <Focusable variant="button" disabled={signOut.isPending} onPress={() => signOut.mutate()}>
          <Icon path={mdiLogout} />
          Sign out
        </Focusable>
        <Focusable variant="button" onPress={() => void window.romm.app.quit()}>
          <Icon path={mdiExitToApp} />
          Exit launcher
        </Focusable>
      </div>

      {account && (
        <div className={styles.panels}>
          <Panel title="Server">
            <Line label="Address" value={account.serverUrl ?? 'Not set'} />
            <Line label="RomM version" value={account.serverVersion ?? 'Unreachable'} />
            <Line label="Launcher version" value={account.launcherVersion} />
          </Panel>

          {account.stats && (
            <Panel title="Library">
              <Line label="Games" value={account.stats.games.toLocaleString()} />
              <Line label="Platforms" value={account.stats.platforms.toLocaleString()} />
              <Line label="Saves" value={account.stats.saves.toLocaleString()} />
              <Line label="Save states" value={account.stats.states.toLocaleString()} />
              <Line label="Size on the server" value={formatSize(account.stats.totalBytes)} />
            </Panel>
          )}

          <Panel title="Devices">
            {account.devices.length === 0 && (
              <span className={ui.muted}>
                This PC registers with RomM the first time it syncs a save.
              </span>
            )}
            {account.devices.map((device) => (
              <Line
                key={device.id}
                label={device.isThisDevice ? `${device.name} (this PC)` : device.name}
                value={[
                  device.client,
                  device.lastSeen ? `seen ${formatWhen(device.lastSeen)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </Panel>
        </div>
      )}

      {signOut.isError && <p className={ui.error}>{errorMessage(signOut.error)}</p>}
      {testing && <ControllerTest onClose={closeTest} />}
    </Screen>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={ui.widget}>
      <h2 className={ui.widgetTitle}>{title}</h2>
      {children}
    </section>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.line}>
      <span>{label}</span>
      <span className={ui.muted}>{value}</span>
    </div>
  );
}
