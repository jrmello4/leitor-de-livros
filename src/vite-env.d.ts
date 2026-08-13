/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SMOKE_TEST?: string;
  readonly VITE_VISUAL_TEST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
