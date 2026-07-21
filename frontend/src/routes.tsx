import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './app/ProtectedRoute';
import { RequireRealmAdmin } from './app/RequireRealmAdmin';
import { WorkspaceScopeRoute } from './app/WorkspaceScopeRoute';
import { RootRedirect } from './app/RootRedirect';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { CheckEmailPage } from './features/auth/CheckEmailPage';
import { VerifyEmailPage } from './features/auth/VerifyEmailPage';
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './features/auth/ResetPasswordPage';
import { RequestAccessPage } from './features/auth/RequestAccessPage';
import { LauncherPage } from './features/launcher/LauncherPage';
import { AdminConsolePage } from './features/admin/AdminConsolePage';
import { WorkspacesTab } from './features/admin/WorkspacesTab';
import { RealmMembersTab } from './features/admin/RealmMembersTab';
import { JoinRequestsTab } from './features/admin/JoinRequestsTab';
import { RealmSettingsTab } from './features/admin/RealmSettingsTab';
import { MigrationsAdminTab } from './features/admin/MigrationsAdminTab';
import { WorkspaceLayout } from './features/workspace/WorkspaceLayout';
import { WorkspaceContent } from './features/workspace/content';
import { StarredPagesView } from './features/workspace/content/StarredPagesView';
import { MigrationsPage } from './features/migration/MigrationsPage';
import { LinkDocView } from './features/link/LinkDocView';

export function AppRoutes() {
  return (
    <Routes>
      {/* public auth */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/register/check-email" element={<CheckEmailPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* public share link (works logged-out for ANYONE-scope links) */}
      <Route path="/link/:token" element={<LinkDocView />} />

      {/* authenticated */}
      <Route element={<ProtectedRoute />}>
        <Route path="/access" element={<RequestAccessPage />} />
        <Route path="/launcher" element={<LauncherPage />} />

        {/* realm admin console */}
        <Route element={<RequireRealmAdmin />}>
          <Route path="/admin" element={<AdminConsolePage />}>
            <Route index element={<Navigate to="/admin/workspaces" replace />} />
            <Route path="workspaces" element={<WorkspacesTab />} />
            <Route path="members" element={<RealmMembersTab />} />
            <Route path="requests" element={<JoinRequestsTab />} />
            <Route path="migrations" element={<MigrationsAdminTab />} />
            <Route path="migrations/:jobId" element={<MigrationsAdminTab />} />
            <Route path="settings" element={<RealmSettingsTab />} />
          </Route>
        </Route>

        {/* inside a workspace (scope is entered before render) */}
        <Route path="/w/:workspaceId" element={<WorkspaceScopeRoute />}>
          <Route element={<WorkspaceLayout />}>
            <Route index element={<WorkspaceContent />} />
            <Route path="starred" element={<StarredPagesView />} />
            <Route path="migrations" element={<MigrationsPage />} />
            <Route path="migrations/:jobId" element={<MigrationsPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
