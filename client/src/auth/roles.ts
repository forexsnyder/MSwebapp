export type AppRole = "Requester" | "Picker" | "Auditor";

export const ALL_ROLES: AppRole[] = ["Requester", "Picker", "Auditor"];

export function isAppRole(value: unknown): value is AppRole {
  return value === "Requester" || value === "Picker" || value === "Auditor";
}

export function hasRole(roles: AppRole[], role: AppRole) {
  return roles.includes("Auditor") || roles.includes(role);
}

export function hasAnyRole(roles: AppRole[], requiredRoles: AppRole[]) {
  return roles.includes("Auditor") || requiredRoles.some((role) => roles.includes(role));
}
