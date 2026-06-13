/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AZURE_CLIENT_ID?: string;
  readonly VITE_AZURE_AUTHORITY_HOST?: string;
  readonly VITE_AZURE_TENANT_ID?: string;
  readonly VITE_AZURE_REDIRECT_URI?: string;
  readonly VITE_AZURE_LOGIN_HINT?: string;
  readonly VITE_DEV_AUTH_BYPASS?: string;
  readonly VITE_DEV_AUTH_USER?: string;
  readonly VITE_DEV_AUTH_ROLES?: string;
}
