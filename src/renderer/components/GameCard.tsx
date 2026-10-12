import { useState } from 'react';
import type { CollectionSummary, PlatformSummary, RomSummary } from '../../shared/ipc';
import { assetUrl } from '../assets';
import { Focusable } from './Focusable';
import { PlatformIcon } from './Icon';
import { Logo } from './Logo';
import styles from './ui.module.css';
import cards from './cards.module.css';

export function Cover({ path, title }: { path: string | null; title: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={styles.cover}>
      {path && !failed ? (
        <img
          className={styles.coverImage}
          src={assetUrl(path)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <Logo className={styles.coverMark} />
          <div className={styles.coverFallback}>{title}</div>
        </>
      )}
    </div>
  );
}

interface GameCardProps {
  rom: RomSummary;
  focusKey: string;
  preferred?: boolean;
  /** Shows which platform the game is for; useful where platforms are mixed. */
  showPlatform?: boolean;
  onOpen: (romId: number) => void;
}

export function GameCard({ rom, focusKey, preferred, showPlatform, onOpen }: GameCardProps) {
  return (
    <Focusable
      className={styles.card}
      focusKey={focusKey}
      preferred={preferred}
      ambient={rom.coverPath}
      onPress={() => onOpen(rom.id)}
    >
      <div style={{ position: 'relative' }}>
        <Cover path={rom.coverPath} title={rom.name} />
        {showPlatform && (
          <span className={styles.platformBadge}>
            <PlatformIcon slug={rom.platformSlug} />
          </span>
        )}
        {rom.downloaded && <span className={styles.badge}>On this PC</span>}
        {rom.syncStatus && rom.syncStatus !== 'synced' && (
          <span className={`${styles.badge} ${styles.warnBadge}`}>
            {rom.syncStatus === 'conflict' ? 'Save conflict' : 'Not synced'}
          </span>
        )}
      </div>
      <span className={styles.cardTitle}>{rom.name}</span>
    </Focusable>
  );
}

export function PlatformCard(props: {
  platform: PlatformSummary;
  focusKey: string;
  preferred?: boolean;
  onOpen: () => void;
}) {
  const { platform } = props;
  return (
    <Focusable
      className={cards.tile}
      focusKey={props.focusKey}
      preferred={props.preferred}
      onPress={props.onOpen}
    >
      <div className={cards.tileArt}>
        <PlatformIcon slug={platform.slug} className={cards.tileIcon} />
      </div>
      <span className={cards.tileName}>{platform.name}</span>
      <span className={cards.tileCount}>
        {platform.romCount} {platform.romCount === 1 ? 'game' : 'games'}
      </span>
    </Focusable>
  );
}

export function CollectionCard(props: {
  collection: CollectionSummary;
  focusKey: string;
  preferred?: boolean;
  onOpen: () => void;
}) {
  const { collection } = props;
  const covers = collection.coverPaths.slice(0, 4);
  return (
    <Focusable
      className={cards.tile}
      focusKey={props.focusKey}
      preferred={props.preferred}
      ambient={covers[0] ?? null}
      onPress={props.onOpen}
    >
      {/* Up to four covers of the collection's games, as RomM shows them. */}
      <div className={`${cards.tileArt} ${covers.length > 1 ? cards.collage : ''}`}>
        {covers.length === 0 && <span className={cards.tileInitial}>{collection.name[0]}</span>}
        {covers.map((path) => (
          <img
            key={path}
            className={cards.collageImage}
            src={assetUrl(path)}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ))}
      </div>
      <span className={cards.tileName}>{collection.name}</span>
      <span className={cards.tileCount}>
        {collection.romCount} {collection.romCount === 1 ? 'game' : 'games'}
      </span>
    </Focusable>
  );
}
