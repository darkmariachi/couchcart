import { useQuery } from '@tanstack/react-query';
import { errorMessage, unwrap } from '../../api';
import styles from './Debug.module.css';

/** Raw save and state records for one ROM, exactly as RomM returns them. */
export function RomAssetsPanel({ romId }: { romId: number }) {
  const assets = useQuery({
    queryKey: ['romAssets', romId],
    queryFn: () => unwrap(window.romm.library.romAssets(romId)),
  });

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>Saves and states for ROM {romId}</h2>
      {assets.isPending && <p className={styles.muted}>Loading…</p>}
      {assets.isError && <p className={styles.error}>{errorMessage(assets.error)}</p>}
      {assets.data && (
        <div className={styles.stack}>
          <div>
            <p className={styles.muted}>
              GET /api/saves?rom_id={romId} → {assets.data.saves.length}
            </p>
            <pre className={styles.json}>{JSON.stringify(assets.data.saves, null, 2)}</pre>
          </div>
          <div>
            <p className={styles.muted}>
              GET /api/states?rom_id={romId} → {assets.data.states.length}
            </p>
            <pre className={styles.json}>{JSON.stringify(assets.data.states, null, 2)}</pre>
          </div>
        </div>
      )}
    </section>
  );
}
