import { useMutation } from '@tanstack/react-query';
import { errorMessage, unwrap } from '../../api';
import styles from './Debug.module.css';

/** Runs the read-only checks that settle what the OpenAPI spec does not document. */
export function ApiProbePanel() {
  const probe = useMutation({ mutationFn: () => unwrap(window.romm.debug.apiProbe()) });

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>API probe</h2>
      <div className={styles.row}>
        <button className={styles.button} onClick={() => probe.mutate()} disabled={probe.isPending}>
          {probe.isPending ? 'Probing…' : 'Run read-only probe'}
        </button>
        {probe.isError && <span className={styles.error}>{errorMessage(probe.error)}</span>}
      </div>
      {probe.data?.map((finding) => (
        <div key={finding.question} style={{ marginTop: 12 }}>
          <strong>{finding.question}</strong> {finding.answer}
          <ul className={styles.evidence}>
            {finding.evidence.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
