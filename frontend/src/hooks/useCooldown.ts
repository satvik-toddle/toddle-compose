import { useCallback, useEffect, useRef, useState } from 'react';

// A simple N-second countdown. Mirrors the backend per-account email cooldown so
// the resend buttons stay disabled (with a live countdown) for the same window.
export function useCooldown(seconds: number) {
  const [remaining, setRemaining] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const start = useCallback(() => {
    setRemaining(seconds);
    stop();
    timer.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          stop();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
  }, [seconds, stop]);

  useEffect(() => stop, [stop]);

  return { remaining, active: remaining > 0, start };
}

export const EMAIL_RESEND_COOLDOWN_SEC = 60;
