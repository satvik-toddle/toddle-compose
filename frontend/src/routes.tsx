import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './app/ProtectedRoute';
import { RequireRealmAdmin } from './app/RequireRealmAdmin';
import { WorkspaceScopeRoute } from './app/WorkspaceScopeRoute';
import { RootRedirect } from './app/RootRedirect';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { RegisterSuccessPage } from './features/auth/RegisterSuccessPage';
import { RequestAccessPage } from './features/auth/RequestAccessPage';
import { LauncherPage } from './features/launcher/LauncherPage';
import { AdminConsolePage } from './features/admin/AdminConsolePage';
import { WorkspacesTab } from './features/admin/WorkspacesTab';
import { RealmMembersTab } from './features/admin/RealmMembersTab';
import { JoinRequestsTab } from './features/admin/JoinRequestsTab';
import { WorkspaceLayout } from './features/workspace/WorkspaceLayout';
import { PagesPanel } from './features/workspace/PagesPanel';
import { MembersPanel } from './features/workspace/MembersPanel';
import { RequestsPanel } from './features/workspace/RequestsPanel';

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

        {/* realm admin console */}
        <Route element={<RequireRealmAdmin />}>
          <Route path="/admin" element={<AdminConsolePage />}>
            <Route index element={<Navigate to="/admin/workspaces" replace />} />
            <Route path="workspaces" element={<WorkspacesTab />} />
            <Route path="members" element={<RealmMembersTab />} />
            <Route path="requests" element={<JoinRequestsTab />} />
          </Route>
        </Route>

        {/* inside a workspace (scope is entered before render) */}
        <Route path="/w/:workspaceId" element={<WorkspaceScopeRoute />}>
          <Route element={<WorkspaceLayout />}>
            <Route index element={<PagesPanel />} />
            <Route path="members" element={<MembersPanel />} />
            <Route path="requests" element={<RequestsPanel />} />
          </Route>
        </Route>
      </Route>

      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
