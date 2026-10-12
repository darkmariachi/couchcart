import { useQuery } from '@tanstack/react-query';
import { errorMessage, unwrap } from '../../api';
import styles from './Debug.module.css';

export function RetroArchPanel() {
  const status = useQuery({
    queryKey: ['retroarch'],
    queryFn: () => unwrap(window.romm.retroarch.status()),
  });

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>RetroArch</h2>
      {status.isPending && <p className={styles.muted}>Detecting…</p>}
      {status.isError && <p className={styles.error}>{errorMessage(status.error)}</p>}
      {status.data && !status.data.found && <p className={styles.error}>Not found.</p>}
      {status.data?.found && (
        <>
          <p>
            {status.data.version} ({status.data.kind})
          </p>
          <ul className={styles.evidence}>
            <li>{status.data.executablePath}</li>
            <li>
              {status.data.installedCores.length} cores:{' '}
              {status.data.installedCores.map((core) => core.replace('_libretro', '')).join(', ')}
            </li>
          </ul>
        </>
      )}
    </section>
  );
}
