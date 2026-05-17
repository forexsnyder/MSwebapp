import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./auth/RequireAuth";
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
        <Route path="request" element={<RequestPartsPage />} />
        <Route path="pick" element={<PickOrdersPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="audit" element={<AuditorPage />} />
        <Route path="inventory" element={<InventoryAdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
