import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const u = username.trim();
    if (!u) {
      setError("Enter a username.");
      return;
    }
    login(u);
    navigate("/", { replace: true });
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-card__brand">
          <h1 className="login-card__title">MSI Picker</h1>
          <p className="login-card__subtitle">CostPoint Parts Management</p>
        </div>
        <form className="login-form" onSubmit={onSubmit}>
          {error && <p className="banner banner--error">{error}</p>}
          <label className="field">
            <span className="field__label">Username</span>
            <input
              className="field__input field__input--login"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="you@company.com"
            />
          </label>
          <label className="field">
            <span className="field__label">Password</span>
            <input
              className="field__input field__input--login"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </label>
          <button type="submit" className="btn btn--login">
            Login
          </button>
        </form>
      </div>
    </div>
  );
}
