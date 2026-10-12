import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { errorMessage } from './api';
import { Ambient } from './components/Ambient';
import { MenuDialog, type MenuItem } from './components/Dialog';
import { Footer } from './components/Footer';
import { LaunchOverlay } from './components/LaunchOverlay';
import { SECTIONS, TopBar } from './components/TopBar';
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
import { CollectionsScreen, PlatformsScreen } from './screens/BrowseScreens';
import { DebugScreen } from './screens/Debug/DebugScreen';
import { DownloadsScreen } from './screens/DownloadsScreen';
import { GameScreen } from './screens/GameScreen';
import { GridScreen } from './screens/GridScreen';
import { HomeScreen } from './screens/HomeScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SearchScreen } from './screens/SearchScreen';
import { SetupWizard } from './screens/SetupWizard';
import { useCurrentEntry, useSection, useUi } from './store/ui';

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
  const section = useSection();
  const goTo = useUi((state) => state.goTo);
  const stepSection = (step: number) => {
    const order = SECTIONS.map((entry) => entry.route);
    const index = order.findIndex((route) => route === section);
    // From a screen outside the bar (the debug tools), either button returns to Home.
    const target = index === -1 ? 'home' : order[(index + step + order.length) % order.length];
    if (target) goTo({ name: target });
  };
  const libraryReady = Boolean(setup.data?.complete && auth.data?.loggedIn);
  useControls(
    {
      start: { label: 'Menu', run: () => setMenuOpen(true) },
      // LB/RB move along the top bar from anywhere, like tabs.
      ...(libraryReady && {
        lb: { label: 'Previous tab', run: () => stepSection(-1) },
        rb: { label: 'Next tab', run: () => stepSection(1) },
      }),
    },
    { level: 0 },
  );

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
          { label: 'Search', run: () => goTo({ name: 'search', openKeyboard: true }) },
          { label: 'Debug tools', run: () => push({ name: 'debug' }) },
        ]
      : []),
    { label: 'Toggle fullscreen', run: () => void window.romm.app.toggleFullscreen() },
    ...(auth.data.loggedIn ? [{ label: 'Sign out', run: () => void signOut() }] : []),
    { label: 'Exit launcher', run: () => void window.romm.app.quit() },
  ];

  return (
    <div className={ui.shell}>
      <Ambient />
      <TopBar username={auth.data.username} showNavigation={inLibrary} />
      <div className={ui.shellBody}>
        {inLibrary ? (
          <CurrentScreen />
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

function CurrentScreen() {
  const { route } = useCurrentEntry();
  switch (route.name) {
    case 'home':
      return <HomeScreen />;
    case 'platforms':
      return <PlatformsScreen />;
    case 'collections':
      return <CollectionsScreen />;
    case 'search':
      return <SearchScreen openKeyboard={route.openKeyboard ?? false} />;
    case 'grid':
      // Keyed so switching platform with LB/RB, or searching again, starts a clean grid.
      return (
        <GridScreen key={JSON.stringify(route.source)} source={route.source} title={route.title} />
      );
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
