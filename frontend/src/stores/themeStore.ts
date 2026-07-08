import { create } from 'zustand';

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const isThemePreference = (value: string): value is ThemePreference =>
  (THEME_PREFERENCES as readonly string[]).includes(value);

// Must stay in sync with the pre-mount theme script in index.html.
const THEME_STORAGE_KEY = 'toddle-compose-theme';

const systemDarkQuery = globalThis.matchMedia('(prefers-color-scheme: dark)');

const readStoredPreference = (): ThemePreference => {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored !== null && isThemePreference(stored) ? stored : 'system';
};

// Both Tailwind (`darkMode: ['class', '.dark']`) and the ds-web tokens key off
// a `dark` class on <html>, so toggling it switches the whole app.
const applyPreference = (preference: ThemePreference) => {
  const isDark = preference === 'dark' || (preference === 'system' && systemDarkQuery.matches);
  document.documentElement.classList.toggle('dark', isDark);
};

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: readStoredPreference(),
  setPreference: (preference) => {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
    applyPreference(preference);
    set({ preference });
  },
}));

applyPreference(useThemeStore.getState().preference);

// Follow live OS theme changes while in system mode.
systemDarkQuery.addEventListener('change', () => {
  if (useThemeStore.getState().preference === 'system') applyPreference('system');
});
