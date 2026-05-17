import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { LoginPage } from "./LoginPage";

export function LoginGate() {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;
  return <LoginPage />;
}
