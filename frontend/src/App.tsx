import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppRoutes } from './routes';
import { ModalRoot } from './app/ModalRoot';
import { ToastHost } from './components/Toast';
import { registerNavigate } from './lib/scopeGuard';

export function App() {
  const navigate = useNavigate();
  // Let non-React code (access-lost guard) redirect.
  useEffect(() => {
    registerNavigate((to) => navigate(to));
  }, [navigate]);

  return (
    <>
      <AppRoutes />
      <ModalRoot />
      <ToastHost />
    </>
  );
}
