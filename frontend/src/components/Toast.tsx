import { useEffect } from 'react';
import { useUiStore } from '../stores/uiStore';
import { Icon } from './Icon';
import s from './Toast.module.scss';

// Global toast host. Wrapped in a full-screen, transparent, click-through .rbac
// layer so the design's `.rbac .toast` styles apply.
export function ToastHost() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => window.setTimeout(() => dismiss(t.id), 6000));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="rbac"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'transparent',
        display: 'block',
        pointerEvents: 'none',
        height: 'auto',
      }}
    >
      {toasts.slice(-3).map((t, i) => (
        <div
          key={t.id}
          className={s.toast}
          style={{ bottom: 26 + i * 62, pointerEvents: 'auto' }}
        >
          <Icon name={t.kind === 'error' ? 'WarningTriangleOutlined' : 'InformationOutlined'} size={18} />
          <span className={s.tx}>{t.message}</span>
          <button
            className={s.act}
            style={{ border: 0, background: 'transparent', cursor: 'pointer' }}
            onClick={() => dismiss(t.id)}
          >
            Got it
          </button>
        </div>
      ))}
    </div>
  );
}
