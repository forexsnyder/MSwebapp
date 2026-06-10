import { useNavigate } from "react-router-dom";
import { titleForPath } from "./routeTitles";

type AppHeaderProps = {
  pathname: string;
  onLogout: () => void;
};

export function AppHeader({ pathname, onLogout }: AppHeaderProps) {
  const navigate = useNavigate();
  const displayTitle = titleForPath(pathname);
  const showBack = pathname !== "/" && pathname !== "";

  return (
    <header className="app-header">
      <div className="app-header__inner">
        <button
          type="button"
          className="app-header__icon-btn"
          aria-label={showBack ? "Go back" : "Home"}
          onClick={() => (showBack ? navigate(-1) : navigate("/"))}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M15 18l-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="app-header__brand">
          <img className="app-header__logo" src="/brand/msi-picker-logo.png" alt="" aria-hidden="true" />
          <h1 className="app-header__title">{displayTitle}</h1>
        </div>
        <button type="button" className="app-header__logout" onClick={onLogout}>
          Logout
        </button>
      </div>
    </header>
  );
}
