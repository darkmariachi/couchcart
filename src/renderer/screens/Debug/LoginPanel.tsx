import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthStatus } from '../../../shared/ipc';
import { errorMessage, unwrap } from '../../api';
import styles from './Debug.module.css';

export function LoginPanel({ status }: { status: AuthStatus }) {
  const queryClient = useQueryClient();
  const [serverUrl, setServerUrl] = useState(status.serverUrl ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const probe = useMutation({
    mutationFn: () => unwrap(window.romm.server.probe(serverUrl)),
  });

  const login = useMutation({
    mutationFn: () => unwrap(window.romm.auth.login({ serverUrl, username, password })),
    onSuccess: (newStatus) => {
      queryClient.setQueryData(['auth'], newStatus);
    },
    // The password leaves component state as soon as the attempt finishes, either way.
    onSettled: () => setPassword(''),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate();
  };

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>Connect to RomM</h2>
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>
          Server URL
          <input
            className={styles.input}
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            placeholder="https://romm.example.lan"
            spellCheck={false}
            required
          />
        </label>
        <div className={styles.row}>
          <button
            type="button"
            className={styles.button}
            onClick={() => probe.mutate()}
            disabled={!serverUrl || probe.isPending}
          >
            Test connection
          </button>
          {probe.isSuccess && <span>Reachable, RomM {probe.data.version}</span>}
          {probe.isError && <span className={styles.error}>{errorMessage(probe.error)}</span>}
        </div>

        <label className={styles.field}>
          Username
          <input
            className={styles.input}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className={styles.field}>
          Password
          <input
            className={styles.input}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <div className={styles.row}>
          <button type="submit" className={styles.button} disabled={login.isPending}>
            {login.isPending ? 'Logging in…' : 'Log in'}
          </button>
          {login.isError && <span className={styles.error}>{errorMessage(login.error)}</span>}
        </div>
        {!status.credentialsPersisted && (
          <p className={styles.muted}>
            No OS keychain is available, so you will need to log in again after restarting.
          </p>
        )}
      </form>
    </section>
  );
}
