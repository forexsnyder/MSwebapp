import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PublicClientApplication } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { isSecureAuthContext, msalConfig } from "./auth/msalConfig";
import App from "./App.tsx";
import "./index.css";

const msalInstance = isSecureAuthContext ? new PublicClientApplication(msalConfig) : null;
const root = createRoot(document.getElementById("root")!);

function InsecureAuthContextMessage() {
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-card__brand">
          <h1 className="login-card__title">MSI Picker</h1>
          <p className="login-card__subtitle">Microsoft sign-in needs HTTPS</p>
        </div>
        <p className="banner banner--error">
          This address is running over plain HTTP on a network IP. Use HTTPS for
          the Android test URL, or use localhost while testing on this computer.
        </p>
      </div>
    </div>
  );
}

function renderApp() {
  root.render(
    <StrictMode>
      {isSecureAuthContext ? (
        <MsalProvider instance={msalInstance!}>
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </MsalProvider>
      ) : (
        <InsecureAuthContextMessage />
      )}
    </StrictMode>,
  );
}

if (msalInstance) {
  msalInstance.initialize().then(renderApp).catch((error) => {
    console.error("Microsoft sign-in failed to initialize.", error);
    renderApp();
  });
} else {
  renderApp();
}
