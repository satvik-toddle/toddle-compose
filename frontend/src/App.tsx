import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppRoutes } from './routes';
import { ModalRoot } from './app/ModalRoot';
import { ToastHost } from './components/Toast';
import { UploadNotifications } from './components/UploadNotifications';
import { registerNavigate } from './lib/scopeGuard';
import { useSearchShortcut } from './hooks/useSearchShortcut';

export function App() {
  const navigate = useNavigate();
  // Let non-React code (access-lost guard) redirect.
  useEffect(() => {
    registerNavigate((to) => navigate(to));
  }, [navigate]);
  // ⌘/Ctrl+K opens doc search, scoped to the current route.
  useSearchShortcut();

  return (
    <>
      <AppRoutes />
      <ModalRoot />
      <ToastHost />
      <UploadNotifications />
    </>
  );
}
