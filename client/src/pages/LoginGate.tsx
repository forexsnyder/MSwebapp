import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { LoginPage } from "./LoginPage";

export function LoginGate() {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (user) return <Navigate to="/" replace />;
  return <LoginPage />;
}
