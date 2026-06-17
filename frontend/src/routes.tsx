import { Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './app/ProtectedRoute';
import { RootRedirect } from './app/RootRedirect';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { RegisterSuccessPage } from './features/auth/RegisterSuccessPage';
import { RequestAccessPage } from './features/auth/RequestAccessPage';
import { LauncherPage } from './features/launcher/LauncherPage';

export function AppRoutes() {
  return (
    <Routes>
      {/* public auth */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/register/success" element={<RegisterSuccessPage />} />

      {/* authenticated */}
      <Route element={<ProtectedRoute />}>
        <Route path="/access" element={<RequestAccessPage />} />
        <Route path="/launcher" element={<LauncherPage />} />
      </Route>

      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
