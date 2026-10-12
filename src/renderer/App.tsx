import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { errorMessage } from './api';
import { MenuDialog, type MenuItem } from './components/Dialog';
import { Footer } from './components/Footer';
import { LaunchOverlay } from './components/LaunchOverlay';
import ui from './components/ui.module.css';
import {
  useAuthStatus,
  useControllerRedetection,
  useLaunchState,
  useRefreshLibraryAfterActivity,
  useSetupStatus,
} from './hooks';
import { InputProvider } from './input/InputProvider';
import { useControls } from './input/controls';
import { DebugScreen } from './screens/Debug/DebugScreen';
import { DownloadsScreen } from './screens/DownloadsScreen';
import { GameScreen } from './screens/GameScreen';
import { HomeScreen } from './screens/HomeScreen';
import { PlatformScreen } from './screens/PlatformScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SetupWizard } from './screens/SetupWizard';
import { useCurrentEntry, useUi } from './store/ui';

export function App() {
  return (
    <InputProvider>
      <Shell />
    </InputProvider>
  );
}

function Shell() {
  const queryClient = useQueryClient();
  const auth = useAuthStatus();
  const setup = useSetupStatus();
  const launch = useLaunchState();
  useRefreshLibraryAfterActivity(launch);
  useControllerRedetection();

  const { push, reset } = useUi();
  const [menuOpen, setMenuOpen] = useState(false);
  useControls({ start: { label: 'Menu', run: () => setMenuOpen(true) } }, { level: 0 });

  if (auth.isError || setup.isError) {
    return <p className={ui.error}>{errorMessage(auth.error ?? setup.error)}</p>;
  }
  if (!auth.data || !setup.data) return null;

  const inLibrary = setup.data.complete && auth.data.loggedIn;
  const signOut = async () => {
    const result = await window.romm.auth.logout();
    reset();
    queryClient.clear();
    if (result.ok) queryClient.setQueryData(['auth'], result.value);
    void queryClient.invalidateQueries();
  };

  const menu: MenuItem[] = [
    ...(inLibrary
      ? [
          { label: 'Home', run: reset },
          { label: 'Downloads', run: () => push({ name: 'downloads' }) },
          { label: 'Settings', run: () => push({ name: 'settings' }) },
          { label: 'Debug tools', run: () => push({ name: 'debug' }) },
        ]
      : []),
    { label: 'Toggle fullscreen', run: () => void window.romm.app.toggleFullscreen() },
    ...(auth.data.loggedIn ? [{ label: 'Sign out', run: () => void signOut() }] : []),
    { label: 'Exit launcher', run: () => void window.romm.app.quit() },
  ];

  return (
    <div className={ui.shell}>
      <div className={ui.shellBody}>
        {inLibrary ? (
          <CurrentScreen username={auth.data.username} />
        ) : (
          <SetupWizard auth={auth.data} signInOnly={setup.data.complete} />
        )}
      </div>
      <Footer />
      {menuOpen && <MenuDialog title="Menu" items={menu} onClose={() => setMenuOpen(false)} />}
      <LaunchOverlay state={launch} />
    </div>
  );
}

function CurrentScreen({ username }: { username: string | null }) {
  const { route } = useCurrentEntry();
  switch (route.name) {
    case 'home':
      return <HomeScreen username={username} />;
    case 'platform':
      // Keyed so switching platform with LB/RB starts from a clean grid.
      return <PlatformScreen key={route.platformId} platformId={route.platformId} />;
    case 'game':
      return <GameScreen key={route.romId} romId={route.romId} />;
    case 'settings':
      return <SettingsScreen />;
    case 'downloads':
      return <DownloadsScreen />;
    case 'debug':
      return <DebugRoute />;
  }
}

/** The mouse-and-keyboard diagnostics screen from the early milestones. */
function DebugRoute() {
  const pop = useUi((state) => state.pop);
  useControls({ back: { label: 'Back', run: pop } }, { level: 10 });
  return <DebugScreen />;
}
