import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { isMsalConfigured } from "../auth/msalConfig";

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const startedLogin = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/";
  const loginHint =
    new URLSearchParams(location.search).get("login_hint") ||
    new URLSearchParams(location.search).get("upn") ||
    new URLSearchParams(location.search).get("username") ||
    undefined;

  useEffect(() => {
    if (user) {
      navigate(from, { replace: true });
      return;
    }

    if (!isMsalConfigured || startedLogin.current) return;
    startedLogin.current = true;
    void login({ loginHint }).catch((err) => {
      startedLogin.current = false;
      setError(err instanceof Error ? err.message : "Microsoft sign-in failed.");
    });
  }, [from, login, loginHint, navigate, user]);

  function onSignIn() {
    setError(null);
    void login({ loginHint }).catch((err) => {
      setError(err instanceof Error ? err.message : "Microsoft sign-in failed.");
    });
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-card__brand">
          <h1 className="login-card__title">MSI Picker</h1>
          <p className="login-card__subtitle">Signing in with Microsoft</p>
        </div>
        <div className="login-form">
          {!isMsalConfigured && (
            <p className="banner banner--error">
              Azure sign-in is not configured. Add the VITE_AZURE_CLIENT_ID and
              VITE_AZURE_TENANT_ID values, then restart the dev server.
            </p>
          )}
          {error && <p className="banner banner--error">{error}</p>}
          <button type="button" className="btn btn--login" onClick={onSignIn}>
            Sign in with Microsoft
          </button>
        </div>
      </div>
    </div>
  );
}
