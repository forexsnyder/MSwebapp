import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./auth/RequireAuth";
import { RequireRole } from "./auth/RequireRole";
import { Layout } from "./layout/Layout";
import { InventoryAdminPage } from "./pages/InventoryAdminPage";
import { AuditorPage } from "./pages/AuditorPage";
import { LandingPage } from "./pages/LandingPage";
import { LoginGate } from "./pages/LoginGate";
import { HistoryPage } from "./pages/HistoryPage";
import { PickOrdersPage } from "./pages/PickOrdersPage";
import { RequestPartsPage } from "./pages/RequestPartsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginGate />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<LandingPage />} />
        <Route
          path="request"
          element={
            <RequireRole roles={["Requester"]}>
              <RequestPartsPage />
            </RequireRole>
          }
        />
        <Route
          path="pick"
          element={
            <RequireRole roles={["Picker"]}>
              <PickOrdersPage />
            </RequireRole>
          }
        />
        <Route
          path="history"
          element={
            <RequireRole roles={["Requester", "Picker"]}>
              <HistoryPage />
            </RequireRole>
          }
        />
        <Route
          path="audit"
          element={
            <RequireRole roles={["Auditor"]}>
              <AuditorPage />
            </RequireRole>
          }
        />
        <Route
          path="inventory"
          element={
            <RequireRole roles={["Auditor"]}>
              <InventoryAdminPage />
            </RequireRole>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
