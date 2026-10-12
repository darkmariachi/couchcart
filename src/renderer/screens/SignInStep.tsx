import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthStatus, PairingInfo } from '../../shared/ipc';
import { errorMessage, unwrap } from '../api';
import { Field } from '../components/Field';
import { Focusable } from '../components/Focusable';
import { QrCode } from '../components/QrCode';
import ui from '../components/ui.module.css';
import { focusFirst } from '../input/focus';
import styles from './screens.module.css';

interface SignInProps {
  auth: AuthStatus;
  serverUrl: string;
  onNext: () => void;
}

/**
 * Signing in. A pairing code is offered first, since it needs no typing on this PC and
 * the session it gives does not expire weekly; a password is the fallback.
 */
export function SignInStep(props: SignInProps) {
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<'code' | 'password'>('code');

  const signedIn = (status: AuthStatus) => {
    queryClient.setQueryData(['auth'], status);
    props.onNext();
  };
  const logout = useMutation({
    mutationFn: () => unwrap(window.romm.auth.logout()),
    onSuccess: (status) => {
      queryClient.clear();
      queryClient.setQueryData(['auth'], status);
    },
  });

  // Each view has different buttons; put focus on the new view's main one.
  useEffect(() => {
    focusFirst();
  }, [method]);

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

  return method === 'code' ? (
    <CodeSignIn
      serverUrl={props.serverUrl}
      onSignedIn={signedIn}
      onUsePassword={() => setMethod('password')}
    />
  ) : (
    <PasswordSignIn
      auth={props.auth}
      serverUrl={props.serverUrl}
      onSignedIn={signedIn}
      onUseCode={() => setMethod('code')}
    />
  );
}

function CodeSignIn(props: {
  serverUrl: string;
  onSignedIn: (status: AuthStatus) => void;
  onUsePassword: () => void;
}) {
  const { serverUrl, onSignedIn } = props;
  const [pairing, setPairing] = useState<PairingInfo | null>(null);

  const start = useMutation({
    mutationFn: () => unwrap(window.romm.auth.startPairing(serverUrl)),
    onSuccess: setPairing,
  });
  // Ask for a code once when this view opens. (A ref, because React runs effects twice
  // in development and each request would otherwise invalidate the previous code.)
  const requested = useRef(false);
  const { mutate: requestCode } = start;
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    requestCode();
  }, [requestCode]);

  // Ask the server whether the code was approved, as often as it told us to.
  const status = useQuery({
    queryKey: ['pairing', pairing?.userCode],
    queryFn: () => unwrap(window.romm.auth.pairingStatus()),
    enabled: pairing !== null,
    refetchInterval: (query) =>
      query.state.data && query.state.data.state !== 'pending'
        ? false
        : (pairing?.intervalSeconds ?? 5) * 1000,
    staleTime: 0,
    gcTime: 0,
  });
  const state = status.data?.state ?? 'pending';
  const approvedAuth = status.data?.state === 'approved' ? status.data.auth : null;
  const finished = useRef(false);
  useEffect(() => {
    if (!approvedAuth || finished.current) return;
    finished.current = true;
    onSignedIn(approvedAuth);
  }, [approvedAuth, onSignedIn]);

  const ended = state === 'expired' || state === 'denied' || state === 'none';
  const restart = () => {
    setPairing(null);
    start.mutate();
  };

  return (
    <>
      {start.isPending && <p className={ui.muted}>Getting a code from your server…</p>}
      {start.isError && <p className={ui.error}>{errorMessage(start.error)}</p>}

      {pairing && !ended && (
        <div className={styles.pairing}>
          <QrCode text={pairing.completeUrl} className={styles.pairingQr} />
          <div>
            <p>On a phone or computer where you are signed in to RomM, scan the code, or open</p>
            <p className={styles.pairingUrl}>{pairing.verificationUrl}</p>
            <p>and enter</p>
            <p className={styles.pairingCode}>{pairing.userCode}</p>
            <p className={ui.muted}>Waiting for you to approve it there…</p>
          </div>
        </div>
      )}
      {pairing && state === 'expired' && <p className={ui.error}>That code expired.</p>}
      {pairing && state === 'denied' && <p className={ui.error}>The request was denied.</p>}
      {status.isError && <p className={ui.error}>{errorMessage(status.error)}</p>}

      <div className={ui.row}>
        {(ended || start.isError) && (
          <Focusable variant="primary" preferred onPress={restart}>
            Get a new code
          </Focusable>
        )}
        <Focusable
          variant="button"
          preferred={!ended && !start.isError}
          onPress={() => {
            void window.romm.auth.cancelPairing();
            props.onUsePassword();
          }}
        >
          Sign in with a password instead
        </Focusable>
      </div>
    </>
  );
}

function PasswordSignIn(props: {
  auth: AuthStatus;
  serverUrl: string;
  onSignedIn: (status: AuthStatus) => void;
  onUseCode: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const login = useMutation({
    mutationFn: () =>
      unwrap(window.romm.auth.login({ serverUrl: props.serverUrl, username, password })),
    onSuccess: props.onSignedIn,
    // The password leaves memory as soon as the attempt finishes, either way.
    onSettled: () => setPassword(''),
  });

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
        <Focusable variant="button" onPress={props.onUseCode}>
          Use a code instead
        </Focusable>
      </div>
      {login.isError && <p className={ui.error}>{errorMessage(login.error)}</p>}
      <p className={ui.muted}>
        A password sign-in lasts about a week without use. Signing in with a code does not expire
        that way.
      </p>
      {!props.auth.credentialsPersisted && (
        <p className={ui.muted}>
          This PC has no secure credential storage, so you will need to sign in again after
          restarting.
        </p>
      )}
    </>
  );
}
