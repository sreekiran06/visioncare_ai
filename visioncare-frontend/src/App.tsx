import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { NurseDashboard } from "./components/Dashboard/NurseDashboard";
import { CalibrationPage } from "./pages/Calibration/CalibrationPage";
import { PatientSetupPage } from "./pages/PatientSetup/PatientSetupPage";
import { LoginPage } from "./pages/Login/LoginPage";
import { BedsidePage } from "./pages/Bedside/BedsidePage";

// Replace with real values from auth/session context once wired up.
const CURRENT_WARD_ID = process.env.REACT_APP_DEFAULT_WARD_ID ?? "ICU-1";
const CURRENT_NURSE_ID = process.env.REACT_APP_DEFAULT_NURSE_ID ?? "nurse-1";

function RequireAuth({ children }: { children: React.ReactElement }) {
  const token = localStorage.getItem("vc_access_token");
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <NurseDashboard wardId={CURRENT_WARD_ID} nurseId={CURRENT_NURSE_ID} />
            </RequireAuth>
          }
        />

        <Route
          path="/patients/:patientId/calibration"
          element={
            <RequireAuth>
              <CalibrationPage />
            </RequireAuth>
          }
        />

        <Route
          path="/patients/:patientId/setup-mappings"
          element={
            <RequireAuth>
              <PatientSetupPage />
            </RequireAuth>
          }
        />

        <Route
          path="/patients/:patientId/monitor"
          element={
            <RequireAuth>
              <BedsidePage />
            </RequireAuth>
          }
        />

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
