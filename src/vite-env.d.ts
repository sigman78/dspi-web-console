/// <reference types="svelte" />
/// <reference types="vite/client" />

// Build-time palette stylesheet emitted by the virtual:palette.css plugin
// (see vite.config.ts). Side-effect import only -- it registers the .ch-* rules.
declare module 'virtual:palette.css';

// Injected by Vite `define` (see vite.config.ts).
declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;
declare const __BUILD_DATE__: string;

interface ImportMetaEnv {
  // Pairing relay base, e.g. '/room'. Unset: remote-control relay features are off.
  readonly VITE_REMOTE_RELAY?: string;
}
