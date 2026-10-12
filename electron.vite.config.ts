import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// The renderer never talks to the network itself (everything goes through IPC), so the
// production policy allows only bundled assets. Dev additionally needs Vite's inline
// React-refresh preamble and its HMR websocket.
function contentSecurityPolicy(): Plugin {
  const production = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: romm-cover:",
    "font-src 'self'",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ];
  const development = [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: romm-cover:",
    "font-src 'self'",
    "connect-src 'self' ws://localhost:*",
    "base-uri 'none'",
    "form-action 'none'",
  ];
  let isDev = false;
  return {
    name: 'couchcart:csp',
    configResolved(config) {
      isDev = config.command === 'serve';
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: (isDev ? development : production).join('; '),
          },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  // Dependencies are bundled rather than externalized: several are ESM-only and the main
  // process is built as CommonJS. Native modules get externalized explicitly when added.
  main: { build: { externalizeDeps: false } },
  preload: { build: { externalizeDeps: false } },
  renderer: { plugins: [react(), contentSecurityPolicy()] },
});
