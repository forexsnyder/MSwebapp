import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { hasAnyRole, type AppRole } from "./roles";

export function RequireRole({
  roles,
  children,
}: {
  roles: AppRole[];
  children: ReactNode;
}) {
  const { roles: userRoles } = useAuth();

  if (!hasAnyRole(userRoles, roles)) {
    return (
      <div className="page">
        <div className="ui-card ui-card--padded">
          <h2 className="section-title">Access unavailable</h2>
          <p className="muted">
            Your account is not assigned to this workspace.
          </p>
          <Link to="/" className="role-card__cta">
            Home
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
