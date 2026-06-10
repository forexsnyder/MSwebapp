import type { Configuration, RedirectRequest } from "@azure/msal-browser";

const tenantId = import.meta.env.VITE_AZURE_TENANT_ID?.trim();
const clientId = import.meta.env.VITE_AZURE_CLIENT_ID?.trim();
export const defaultLoginHint = import.meta.env.VITE_AZURE_LOGIN_HINT?.trim();

function getDefaultRedirectUri() {
  if (import.meta.env.VITE_AZURE_REDIRECT_URI) {
    return import.meta.env.VITE_AZURE_REDIRECT_URI;
  }

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return "/";
}

export const isMsalConfigured = Boolean(tenantId && clientId);
export const isSecureAuthContext =
  typeof window === "undefined" || Boolean(window.isSecureContext && window.crypto?.subtle);

export const msalConfig: Configuration = {
  auth: {
    clientId: clientId || "missing-client-id",
    authority: tenantId ? `https://login.microsoftonline.com/${tenantId}` : undefined,
    redirectUri: getDefaultRedirectUri(),
    postLogoutRedirectUri: getDefaultRedirectUri(),
  },
  cache: {
    cacheLocation: "localStorage",
  },
};

export const loginRequest: RedirectRequest = {
  scopes: ["openid", "profile", "email"],
  loginHint: defaultLoginHint,
  extraQueryParameters: {
    domain_hint: "organizations",
  },
};
