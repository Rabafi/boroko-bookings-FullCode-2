/**
 * Runtime-specific environment keys exposed to Electron main by electron-vite.
 * The values are optional because the application supports startup without
 * Supabase configuration and reports that condition through its existing path.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
