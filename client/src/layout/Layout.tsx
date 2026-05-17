import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AppFooter } from "./AppFooter";
import { AppHeader } from "./AppHeader";

export function Layout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const tallFooter = false;

  return (
    <div className={`app-viewport${tallFooter ? " app-viewport--tall-footer" : ""}`}>
      <AppHeader pathname={pathname} onLogout={handleLogout} />
      <main className="app-main app-main--shell">
        <Outlet />
      </main>
      <AppFooter />
    </div>
  );
}
