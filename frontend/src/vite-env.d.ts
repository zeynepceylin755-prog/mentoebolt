/// <reference types="vite/client" />

/**
 * Build-time injected API base.
 *
 * Declared here so `tsc --noEmit` and the editor agree with the value the Vite
 * config substitutes (see vite.config.ts `define`).
 */
declare const __MENTORA_API_BASE__: string | undefined;

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
