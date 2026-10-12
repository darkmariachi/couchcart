import { useState } from 'react';
import {
  mdiAccountCircle,
  mdiBookmark,
  mdiCog,
  mdiController,
  mdiDownload,
  mdiHome,
  mdiMagnify,
} from '@mdi/js';
import { ROMM_LOGO_PATH, assetUrl } from '../assets';
import { useSection, useUi, type Route } from '../store/ui';
import { Focusable } from './Focusable';
import { Icon } from './Icon';
import styles from './ui.module.css';

interface Section {
  route: Route['name'];
  label: string;
  icon: string;
}

const SECTIONS: Section[] = [
  { route: 'home', label: 'Home', icon: mdiHome },
  { route: 'platforms', label: 'Platforms', icon: mdiController },
  { route: 'collections', label: 'Collections', icon: mdiBookmark },
  { route: 'downloads', label: 'Downloads', icon: mdiDownload },
  { route: 'settings', label: 'Settings', icon: mdiCog },
];

interface TopBarProps {
  username: string | null;
  /** Hidden during setup, when there is nowhere to navigate to yet. */
  showNavigation: boolean;
  onSearch: () => void;
}

/** RomM-style header: logo, pill navigation, and who is signed in. */
export function TopBar({ username, showNavigation, onSearch }: TopBarProps) {
  const goTo = useUi((state) => state.goTo);
  const section = useSection();
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <header className={styles.topBar}>
      <div className={styles.brand}>
        {/* The logo comes from the RomM server, so it only appears once signed in. */}
        {username && !logoFailed && (
          <img
            className={styles.brandLogo}
            src={assetUrl(ROMM_LOGO_PATH)}
            alt=""
            onError={() => setLogoFailed(true)}
          />
        )}
        ROMM
      </div>

      {showNavigation ? (
        // `data-focus-chrome`: reachable with the d-pad, but never where focus starts.
        <nav className={styles.nav} data-focus-chrome="">
          {SECTIONS.map((entry) => (
            <Focusable
              key={entry.route}
              className={`${styles.navItem} ${section === entry.route ? styles.navActive : ''}`}
              focusKey={`nav-${entry.route}`}
              onPress={() => goTo({ name: entry.route } as Route)}
            >
              <Icon path={entry.icon} />
              {entry.label}
            </Focusable>
          ))}
          <Focusable className={styles.navItem} focusKey="nav-search" onPress={onSearch}>
            <Icon path={mdiMagnify} />
            Search
          </Focusable>
        </nav>
      ) : (
        <span />
      )}

      {username ? (
        <div className={styles.userPill}>
          <Icon path={mdiAccountCircle} />
          {username}
        </div>
      ) : (
        <span />
      )}
    </header>
  );
}
