/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SMOKE_TEST?: string;
  readonly VITE_VISUAL_TEST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

