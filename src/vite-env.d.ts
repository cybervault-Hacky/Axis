/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME?: string;
  readonly VITE_APP_ENV?: "development" | "production" | "test";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
