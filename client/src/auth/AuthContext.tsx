import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import type { AccountInfo } from "@azure/msal-browser";
import { InteractionStatus } from "@azure/msal-browser";
import { useMsal } from "@azure/msal-react";
import { defaultLoginHint, loginRequest } from "./msalConfig";
import { isAppRole, type AppRole } from "./roles";

type LoginOptions = {
  loginHint?: string;
};

type AuthContextValue = {
  user: string | null;
  roles: AppRole[];
  isLoading: boolean;
  login: (options?: LoginOptions) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function getClaim(claims: AccountInfo["idTokenClaims"] | undefined, key: string) {
  const value = claims?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function getAccountDisplayName(account: AccountInfo | null) {
  if (!account) return null;

  const givenName = getClaim(account.idTokenClaims, "given_name");
  const familyName = getClaim(account.idTokenClaims, "family_name");
  const fullName = [givenName, familyName].filter(Boolean).join(" ").trim();

  return fullName || account.name?.trim() || account.username?.trim() || null;
}

function getAccountRoles(account: AccountInfo | null) {
  const roles = account?.idTokenClaims?.roles;
  if (!Array.isArray(roles)) return [];
  return roles.filter(isAppRole);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { instance, accounts, inProgress } = useMsal();
  const activeAccount = instance.getActiveAccount() ?? accounts[0] ?? null;

  useEffect(() => {
    if (!instance.getActiveAccount() && accounts[0]) {
      instance.setActiveAccount(accounts[0]);
    }
  }, [accounts, instance]);

  const user = getAccountDisplayName(activeAccount);
  const roles = getAccountRoles(activeAccount);
  const isLoading =
    inProgress === InteractionStatus.Startup || inProgress === InteractionStatus.HandleRedirect;

  const login = useCallback(async (options?: LoginOptions) => {
    const loginHint = options?.loginHint?.trim() || defaultLoginHint;
    await instance.loginRedirect({
      ...loginRequest,
      loginHint,
    });
  }, [instance]);

  const logout = useCallback(() => {
    const account = instance.getActiveAccount();
    void instance.logoutRedirect(account ? { account } : undefined);
  }, [instance]);

  const value = useMemo(
    () => ({ user, roles, isLoading, login, logout }),
    [user, roles, isLoading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
