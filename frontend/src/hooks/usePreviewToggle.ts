import { useState } from 'react';

// Persisted default-ON preview toggle for the in-workspace search modal.
const STORAGE_KEY = 'docSearch.preview';

function readInitial(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true; // missing → default ON
    return JSON.parse(raw) === true;
  } catch {
    return true; // parse failure → default ON
  }
}

export function usePreviewToggle(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState<boolean>(readInitial);

  const set = (v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    } catch {
      // ignore write failures (private mode / quota) — state still updates in-memory
    }
  };

  return [on, set];
}
