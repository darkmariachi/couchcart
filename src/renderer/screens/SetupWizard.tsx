import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthStatus } from '../../shared/ipc';
import { errorMessage, unwrap } from '../api';
import { AddToSteam } from '../components/AddToSteam';
import { Field } from '../components/Field';
import { Focusable } from '../components/Focusable';
import { Screen } from '../components/Screen';
import { SetupProgressBar } from '../components/SetupProgressBar';
import ui from '../components/ui.module.css';
import { useSetupStatus } from '../hooks';
import { useControls } from '../input/controls';
import { focusFirst } from '../input/focus';
import styles from './screens.module.css';
import { SignInStep } from './SignInStep';

interface StepProps {
  onNext: () => void;
}

interface WizardProps {
  auth: AuthStatus;
  /** After the first run, an expired session only needs the first two steps again. */
  signInOnly: boolean;
}

export function SetupWizard({ auth, signInOnly }: WizardProps) {
  const [index, setIndex] = useState(0);
  const [serverUrl, setServerUrl] = useState(auth.serverUrl ?? '');
  const next = () => setIndex((current) => current + 1);

  const steps: { title: string; body: ReactNode }[] = [
    {
      title: 'Connect to your RomM server',
      body: <ServerStep serverUrl={serverUrl} onChange={setServerUrl} onNext={next} />,
    },
    { title: 'Sign in', body: <SignInStep auth={auth} serverUrl={serverUrl} onNext={next} /> },
    ...(signInOnly
      ? []
      : [
          { title: 'RetroArch', body: <RetroArchStep onNext={next} /> },
          { title: 'Where to keep games', body: <StorageStep onNext={next} /> },
          { title: 'Existing saves', body: <ImportStep onNext={next} /> },
          { title: 'Ready to play', body: <DoneStep /> },
        ]),
  ];
  const step = steps[Math.min(index, steps.length - 1)];

  useControls(
    index > 0 ? { back: { label: 'Previous step', run: () => setIndex(index - 1) } } : {},
    { level: 10 },
  );

  if (!step) return null;
  return (
    // Keyed by step so each one starts with its own main button focused.
    <Screen key={index} title={step.title} subtitle={`Step ${index + 1} of ${steps.length}`}>
      <div className={styles.wizard}>
        <div className={styles.steps}>
          {steps.map((entry, position) => (
            <span
              key={entry.title}
              className={`${styles.stepDot} ${position <= index ? styles.stepDone : ''}`}
            />
          ))}
        </div>
        {step.body}
      </div>
    </Screen>
  );
}

function ServerStep(props: StepProps & { serverUrl: string; onChange: (url: string) => void }) {
  const probe = useMutation({
    mutationFn: () => unwrap(window.romm.server.probe(props.serverUrl)),
    onSuccess: props.onNext,
  });
  const discover = useMutation({
    mutationFn: () => unwrap(window.romm.server.discover()),
  });

  return (
    <>
      <p>Enter the address you use to open RomM in a browser, or let the launcher look for it.</p>
      <Field
        label="Server address"
        value={props.serverUrl}
        placeholder="https://romm.example.lan"
        onChange={props.onChange}
      />
      <div className={ui.row}>
        <Focusable
          variant="primary"
          preferred={props.serverUrl !== ''}
          disabled={!props.serverUrl || probe.isPending}
          onPress={() => probe.mutate()}
        >
          {probe.isPending ? 'Connecting…' : 'Connect'}
        </Focusable>
        <Focusable
          variant="button"
          preferred={props.serverUrl === ''}
          disabled={discover.isPending}
          onPress={() => discover.mutate()}
        >
          {discover.isPending ? 'Looking on your network…' : 'Find my server'}
        </Focusable>
      </div>

      {discover.data?.map((server) => (
        <Focusable
          key={server.url}
          className={styles.field}
          onPress={() => props.onChange(server.url)}
        >
          <span className={styles.fieldLabel}>Found RomM {server.version}</span>
          <span className={styles.fieldValue}>{server.url}</span>
        </Focusable>
      ))}
      {discover.data?.length === 0 && (
        <p className={ui.muted}>
          No RomM server answered on port 8080 on this network. If yours uses another port, or sits
          behind a web address, type that address instead.
        </p>
      )}
      {discover.isError && <p className={ui.error}>{errorMessage(discover.error)}</p>}
      {probe.isError && <p className={ui.error}>{errorMessage(probe.error)}</p>}
    </>
  );
}

function RetroArchStep({ onNext }: StepProps) {
  const retroarch = useQuery({
    queryKey: ['retroarch'],
    queryFn: () => unwrap(window.romm.retroarch.status()),
    staleTime: 0,
  });
  const coverage = useQuery({
    queryKey: ['coreCoverage'],
    queryFn: () => unwrap(window.romm.library.coreCoverage()),
    staleTime: 0,
  });
  const recheck = () => {
    void retroarch.refetch();
    void coverage.refetch();
  };
  const setUp = useMutation({
    mutationFn: () => unwrap(window.romm.retroarch.setUp()),
    onSettled: recheck,
  });
  const installCores = useMutation({
    mutationFn: () => unwrap(window.romm.retroarch.installMissingCores()),
    onSettled: recheck,
  });
  const working = setUp.isPending || installCores.isPending;

  const status = retroarch.data;
  const steam = status?.kind === 'steam';
  const missingCores =
    coverage.data?.filter((platform) => !platform.core && platform.candidates.length > 0) ?? [];
  const canGetCores = Boolean(status?.found && status.canInstallCores && missingCores.length);

  // The buttons change as things get installed; keep focus on the main one.
  const found = status?.found;
  useEffect(() => {
    if (!working) focusFirst();
  }, [working, found, canGetCores]);
  return (
    <>
      {retroarch.isPending && <p className={ui.muted}>Looking for RetroArch…</p>}
      {status && !status.found && !setUp.isPending && (
        <p className={status.canSetUp ? undefined : ui.error}>
          {status.canSetUp
            ? 'Games run in RetroArch, a free emulator, and it is not on this PC yet. The launcher can download it for you from libretro, its makers (about 200 MB), and keep it in its own folder.'
            : 'RetroArch was not found. It is free: install it from Steam or from retroarch.com, then choose “Check again”. Games cannot start without it.'}
        </p>
      )}
      {setUp.isPending && <SetupProgressBar idle="Contacting the download server…" />}
      {setUp.isError && <p className={ui.error}>{errorMessage(setUp.error)}</p>}
      {status?.found && (
        <p>
          Found RetroArch {status.version}
          {steam ? ' (Steam)' : ''}
          {status.managed ? ' (set up by the launcher)' : ''} with {status.installedCores.length}{' '}
          {status.installedCores.length === 1 ? 'core' : 'cores'}.
        </p>
      )}

      {coverage.data && coverage.data.length > 0 && (
        <ul className={styles.list}>
          {coverage.data.map((platform) => (
            <li key={platform.slug}>
              <strong>{platform.name}</strong> ({platform.romCount} games):{' '}
              {platform.core ? (
                <span className={ui.ok}>ready, using {shortName(platform.core)}</span>
              ) : (
                <span className={ui.error}>
                  {platform.candidates.length > 0
                    ? `needs a core: ${platform.candidates.map(shortName).join(' or ')}`
                    : 'no core is mapped to this platform yet'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {installCores.isPending && <SetupProgressBar idle="Contacting the download server…" />}
      {installCores.isError && <p className={ui.error}>{errorMessage(installCores.error)}</p>}
      {installCores.data?.failed.map((failure) => (
        <p key={failure.platform} className={ui.error}>
          {failure.platform}: {failure.reason}
        </p>
      ))}
      {coverage.data?.some((platform) => !platform.core) && status?.found && !canGetCores && (
        <p className={ui.muted}>
          {steam
            ? 'Add missing cores from RetroArch’s DLC list in Steam.'
            : 'Add missing cores in RetroArch under Online Updater → Core Downloader.'}{' '}
          You can do this later; the other platforms work now.
        </p>
      )}

      <div className={ui.row}>
        {status && !status.found && status.canSetUp && (
          <Focusable variant="primary" preferred disabled={working} onPress={() => setUp.mutate()}>
            {setUp.isPending ? 'Setting up RetroArch…' : 'Set up RetroArch for me'}
          </Focusable>
        )}
        {canGetCores && (
          <Focusable
            variant="primary"
            preferred
            disabled={working}
            onPress={() => installCores.mutate()}
          >
            {installCores.isPending
              ? 'Downloading cores…'
              : `Download the ${missingCores.length === 1 ? 'missing core' : `${missingCores.length} missing cores`}`}
          </Focusable>
        )}
        <Focusable
          variant={status?.found && !canGetCores ? 'primary' : 'button'}
          preferred={Boolean(status?.found) && !canGetCores}
          disabled={working}
          onPress={onNext}
        >
          {status?.found ? 'Continue' : 'Skip for now'}
        </Focusable>
        <Focusable variant="button" disabled={working} onPress={recheck}>
          Check again
        </Focusable>
        {status && !status.found && (
          <>
            <Focusable
              variant="button"
              onPress={() => void window.romm.app.openLink('retroarch-steam')}
            >
              Get RetroArch on Steam
            </Focusable>
            <Focusable
              variant="button"
              onPress={() => void window.romm.app.openLink('retroarch-website')}
            >
              Open retroarch.com
            </Focusable>
          </>
        )}
      </div>
    </>
  );
}

function StorageStep({ onNext }: StepProps) {
  const queryClient = useQueryClient();
  const setup = useSetupStatus();
  const choose = useMutation({
    mutationFn: () => unwrap(window.romm.setup.chooseCacheDir()),
    onSuccess: (status) => queryClient.setQueryData(['setup'], status),
  });

  return (
    <>
      <p>
        Games are downloaded the first time you play them and kept on this PC so they start
        instantly afterwards.
      </p>
      {setup.data && (
        <ul className={styles.list}>
          <li>
            Folder: <strong>{setup.data.cacheDir}</strong>
          </li>
          {setup.data.freeBytes !== null && (
            <li>Free space: {(setup.data.freeBytes / 1024 ** 3).toFixed(0)} GB</li>
          )}
        </ul>
      )}
      <div className={ui.row}>
        <Focusable variant="primary" preferred onPress={onNext}>
          Continue
        </Focusable>
        <Focusable variant="button" disabled={choose.isPending} onPress={() => choose.mutate()}>
          Change folder…
        </Focusable>
      </div>
      {choose.isError && <p className={ui.error}>{errorMessage(choose.error)}</p>}
    </>
  );
}

function ImportStep({ onNext }: StepProps) {
  const preview = useQuery({
    queryKey: ['importPreview'],
    queryFn: () => unwrap(window.romm.setup.importPreview()),
    staleTime: 0,
  });
  const run = useMutation({ mutationFn: () => unwrap(window.romm.setup.importSaves()) });

  // The buttons only exist once the search has finished, so focus is placed then.
  const searched = !preview.isPending;
  useEffect(() => {
    if (searched) focusFirst();
  }, [searched, run.isSuccess]);

  if (run.isSuccess) {
    return (
      <>
        <p className={ui.ok}>
          Imported {run.data} file{run.data === 1 ? '' : 's'}. Each game’s progress uploads to RomM
          the next time you play it or choose “Sync saves” on its page.
        </p>
        <div className={ui.row}>
          <Focusable variant="primary" preferred onPress={onNext}>
            Continue
          </Focusable>
        </div>
      </>
    );
  }

  const found = preview.data ? preview.data.saves + preview.data.states : 0;
  return (
    <>
      {preview.isPending && <p className={ui.muted}>Looking for saves you already have…</p>}
      {preview.isError && <p className={ui.error}>{errorMessage(preview.error)}</p>}
      {preview.data && found === 0 && (
        <p>No existing RetroArch saves for games in your library were found. Nothing to import.</p>
      )}
      {preview.data && found > 0 && (
        <>
          <p>
            RetroArch already has {describeCount(preview.data.saves, 'save')}
            {preview.data.states > 0 &&
              ` and ${describeCount(preview.data.states, 'save state')}`}{' '}
            for games in your library:
          </p>
          <ul className={styles.list}>
            {preview.data.games.slice(0, 8).map((game) => (
              <li key={game}>{game}</li>
            ))}
            {preview.data.games.length > 8 && (
              <li className={ui.muted}>and {preview.data.games.length - 8} more</li>
            )}
          </ul>
          <p className={ui.muted}>
            Importing copies them so you can continue where you left off and sync them to RomM.
            RetroArch’s own files are left untouched.
          </p>
        </>
      )}
      {searched && (
        <div className={ui.row}>
          {found > 0 && (
            <Focusable
              variant="primary"
              preferred
              disabled={run.isPending}
              onPress={() => run.mutate()}
            >
              {run.isPending ? 'Importing…' : 'Import'}
            </Focusable>
          )}
          <Focusable
            variant={found > 0 ? 'button' : 'primary'}
            preferred={found === 0}
            onPress={onNext}
          >
            {found > 0 ? 'Skip' : 'Continue'}
          </Focusable>
        </div>
      )}
      {run.isError && <p className={ui.error}>{errorMessage(run.error)}</p>}
    </>
  );
}

function DoneStep() {
  const queryClient = useQueryClient();
  const complete = useMutation({
    mutationFn: () => unwrap(window.romm.setup.complete()),
    onSuccess: (status) => queryClient.setQueryData(['setup'], status),
  });

  return (
    <>
      <p>
        Pick a game and press A to play. Your progress is saved to RomM when you quit, so you can
        continue on another PC.
      </p>
      <div className={ui.row}>
        <Focusable variant="primary" preferred onPress={() => complete.mutate()}>
          Start
        </Focusable>
      </div>
      {complete.isError && <p className={ui.error}>{errorMessage(complete.error)}</p>}
      <AddToSteam />
    </>
  );
}

function shortName(core: string): string {
  return core.replace(/_libretro$/, '');
}

function describeCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
