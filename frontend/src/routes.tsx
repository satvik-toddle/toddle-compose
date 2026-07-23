import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './app/ProtectedRoute';
import { MembershipGate } from './app/MembershipGate';
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
import { OrgRequestsTab } from './features/admin/OrgRequestsTab';
import { RealmSettingsTab } from './features/admin/RealmSettingsTab';
import { WorkspaceLayout } from './features/workspace/WorkspaceLayout';
import { WorkspaceContent } from './features/workspace/content';
import { StarredPagesView } from './features/workspace/content/StarredPagesView';
import { LinkDocView } from './features/link/LinkDocView';

// Dev-only Zwibbler → tldraw converter harness; lazy so tldraw stays out of the main bundle.
const ZwibblerPreviewPage = lazy(() =>
  import('./features/workspace/whiteboard/zwibbler/ZwibblerPreviewPage').then((m) => ({
    default: m.ZwibblerPreviewPage,
  })),
);

// Dev-only whiteboard perf harness.
const WhiteboardBenchPage = lazy(() =>
  import('./features/workspace/whiteboard/WhiteboardBenchPage').then((m) => ({
    default: m.WhiteboardBenchPage,
  })),
);

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
        {/* realm admin console (its own admin gate; not behind the membership gate) */}
        <Route element={<RequireRealmAdmin />}>
          <Route path="/admin" element={<AdminConsolePage />}>
            <Route index element={<Navigate to="/admin/workspaces" replace />} />
            <Route path="workspaces" element={<WorkspacesTab />} />
            <Route path="members" element={<RealmMembersTab />} />
            <Route path="requests" element={<JoinRequestsTab />} />
            <Route path="org-requests" element={<OrgRequestsTab />} />
            <Route path="settings" element={<RealmSettingsTab />} />
          </Route>
        </Route>

        {/* non-members are held at the org join gate when join-requests are enabled */}
        <Route element={<MembershipGate />}>
          <Route path="/access" element={<RequestAccessPage />} />
          <Route path="/launcher" element={<LauncherPage />} />

          {/* inside a workspace (scope is entered before render) */}
          <Route path="/w/:workspaceId" element={<WorkspaceScopeRoute />}>
            <Route element={<WorkspaceLayout />}>
              <Route index element={<WorkspaceContent />} />
              <Route path="starred" element={<StarredPagesView />} />
            </Route>
          </Route>
        </Route>
      </Route>

      {import.meta.env.DEV && (
        <>
          <Route
            path="/zwibbler-preview"
            element={
              <Suspense fallback={null}>
                <ZwibblerPreviewPage />
              </Suspense>
            }
          />
          <Route
            path="/whiteboard-bench"
            element={
              <Suspense fallback={null}>
                <WhiteboardBenchPage />
              </Suspense>
            }
          />
        </>
      )}

      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
