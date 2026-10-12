import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthStatus } from '../../shared/ipc';
import { errorMessage, unwrap } from '../api';
import { Focusable } from '../components/Focusable';
import { OnScreenKeyboard } from '../components/OnScreenKeyboard';
import { Screen } from '../components/Screen';
import ui from '../components/ui.module.css';
import { useSetupStatus } from '../hooks';
import { useControls } from '../input/controls';
import { focusFirst } from '../input/focus';
import styles from './screens.module.css';

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

/** A value the user edits with the on-screen keyboard. */
function Field(props: {
  label: string;
  value: string;
  secret?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const shown = props.secret ? '•'.repeat(props.value.length) : props.value;
  return (
    <>
      <Focusable className={styles.field} onPress={() => setEditing(true)}>
        <span className={styles.fieldLabel}>{props.label}</span>
        <span className={`${styles.fieldValue} ${shown ? '' : ui.muted}`}>
          {shown || props.placeholder || 'Press A to enter'}
        </span>
      </Focusable>
      {editing && (
        <OnScreenKeyboard
          title={props.label}
          initialValue={props.value}
          secret={props.secret}
          onCancel={() => setEditing(false)}
          onSubmit={(value) => {
            props.onChange(value);
            setEditing(false);
          }}
        />
      )}
    </>
  );
}

function ServerStep(props: StepProps & { serverUrl: string; onChange: (url: string) => void }) {
  const probe = useMutation({
    mutationFn: () => unwrap(window.romm.server.probe(props.serverUrl)),
    onSuccess: props.onNext,
  });

  return (
    <>
      <p>Enter the address you use to open RomM in a browser.</p>
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
      </div>
      {probe.isError && <p className={ui.error}>{errorMessage(probe.error)}</p>}
    </>
  );
}

function SignInStep(props: StepProps & { auth: AuthStatus; serverUrl: string }) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const login = useMutation({
    mutationFn: () =>
      unwrap(window.romm.auth.login({ serverUrl: props.serverUrl, username, password })),
    onSuccess: (status) => {
      queryClient.setQueryData(['auth'], status);
      props.onNext();
    },
    // The password leaves memory as soon as the attempt finishes, either way.
    onSettled: () => setPassword(''),
  });
  const logout = useMutation({
    mutationFn: () => unwrap(window.romm.auth.logout()),
    onSuccess: (status) => {
      queryClient.clear();
      queryClient.setQueryData(['auth'], status);
    },
  });

  if (props.auth.loggedIn) {
    return (
      <>
        <p>
          Signed in as <strong>{props.auth.username}</strong>.
        </p>
        <div className={ui.row}>
          <Focusable variant="primary" preferred onPress={props.onNext}>
            Continue
          </Focusable>
          <Focusable variant="button" onPress={() => logout.mutate()}>
            Use a different account
          </Focusable>
        </div>
      </>
    );
  }

  return (
    <>
      <Field label="Username" value={username} onChange={setUsername} />
      <Field label="Password" value={password} secret onChange={setPassword} />
      <div className={ui.row}>
        <Focusable
          variant="primary"
          disabled={!username || !password || login.isPending}
          onPress={() => login.mutate()}
        >
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Focusable>
      </div>
      {login.isError && <p className={ui.error}>{errorMessage(login.error)}</p>}
      {!props.auth.credentialsPersisted && (
        <p className={ui.muted}>
          This PC has no secure credential storage, so you will need to sign in again after
          restarting.
        </p>
      )}
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

  const status = retroarch.data;
  const steam = status?.kind === 'steam';
  return (
    <>
      {retroarch.isPending && <p className={ui.muted}>Looking for RetroArch…</p>}
      {status && !status.found && (
        <p className={ui.error}>
          RetroArch was not found. Install it (from retroarch.com or Steam), then choose “Check
          again”. Games cannot start without it.
        </p>
      )}
      {status?.found && (
        <p>
          Found RetroArch {status.version}
          {steam ? ' (Steam)' : ''} with {status.installedCores.length} cores.
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
      {coverage.data?.some((platform) => !platform.core) && status?.found && (
        <p className={ui.muted}>
          {steam
            ? 'Add missing cores from RetroArch’s DLC list in Steam.'
            : 'Add missing cores in RetroArch under Online Updater → Core Downloader.'}{' '}
          You can do this later; the other platforms work now.
        </p>
      )}

      <div className={ui.row}>
        <Focusable variant="primary" preferred onPress={onNext}>
          Continue
        </Focusable>
        <Focusable variant="button" onPress={recheck}>
          Check again
        </Focusable>
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
    </>
  );
}

function shortName(core: string): string {
  return core.replace(/_libretro$/, '');
}

function describeCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
