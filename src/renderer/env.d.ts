/// <reference types="vite/client" />
import type { LauncherApi } from '../shared/ipc';

declare global {
  interface Window {
    romm: LauncherApi;
  }
}
