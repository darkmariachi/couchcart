import {
  mdiAccountCircle,
  mdiBookmark,
  mdiCog,
  mdiController,
  mdiDownload,
  mdiHome,
  mdiMagnify,
} from '@mdi/js';
import { APP_NAME } from '../../shared/app';
import { useSection, useUi, type Route } from '../store/ui';
import { Focusable } from './Focusable';
import { Icon } from './Icon';
import { Logo } from './Logo';
import styles from './ui.module.css';

interface Section {
  route: Route['name'];
  label: string;
  icon: string;
}

/** The top-level sections, in the order they are shown and LB/RB step through them. */
export const SECTIONS = [
  { route: 'home', label: 'Home', icon: mdiHome },
  { route: 'platforms', label: 'Platforms', icon: mdiController },
  { route: 'collections', label: 'Collections', icon: mdiBookmark },
  { route: 'search', label: 'Search', icon: mdiMagnify },
  { route: 'downloads', label: 'Downloads', icon: mdiDownload },
  { route: 'settings', label: 'Settings', icon: mdiCog },
] as const satisfies readonly Section[];

/**
 * Every stop LB/RB make along the top bar: the sections, then the account pill at the
 * right-hand end.
 */
export const SECTION_ORDER: Route['name'][] = [...SECTIONS.map((entry) => entry.route), 'account'];

interface TopBarProps {
  username: string | null;
  /** Hidden during setup, when there is nowhere to navigate to yet. */
  showNavigation: boolean;
}

/** The header: logo, pill navigation, and who is signed in. */
export function TopBar({ username, showNavigation }: TopBarProps) {
  const goTo = useUi((state) => state.goTo);
  const section = useSection();

  return (
    <header className={styles.topBar}>
      <div className={styles.brand}>
        <Logo className={styles.brandLogo} />
        {APP_NAME.toUpperCase()}
      </div>

      {showNavigation ? (
        // `data-focus-chrome`: reachable with the d-pad, but never where focus starts.
        <nav className={styles.nav} data-focus-chrome="">
          {SECTIONS.map((entry) => (
            <Focusable
              key={entry.route}
              className={`${styles.navItem} ${section === entry.route ? styles.navActive : ''}`}
              focusKey={`nav-${entry.route}`}
              // Choosing Search on purpose goes straight to the keyboard.
              onPress={() =>
                goTo(
                  entry.route === 'search'
                    ? { name: 'search', openKeyboard: true }
                    : { name: entry.route },
                )
              }
            >
              <Icon path={entry.icon} />
              {entry.label}
            </Focusable>
          ))}
        </nav>
      ) : (
        <span />
      )}

      {username && showNavigation ? (
        <div className={styles.userSlot} data-focus-chrome="">
          <Focusable
            className={`${styles.userPill} ${section === 'account' ? styles.navActive : ''}`}
            focusKey="nav-account"
            onPress={() => goTo({ name: 'account' })}
          >
            <Icon path={mdiAccountCircle} />
            {username}
          </Focusable>
        </div>
      ) : username ? (
        <div className={styles.userSlot}>
          <div className={styles.userPill}>
            <Icon path={mdiAccountCircle} />
            {username}
          </div>
        </div>
      ) : (
        <span />
      )}
    </header>
  );
}
