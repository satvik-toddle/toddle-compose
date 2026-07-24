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

// Resolve a preference to the effective dark/light the app renders. Single source
// of truth for consumers that need the explicit value (e.g. Excalidraw's `theme`
// prop, the share-link toggle) rather than keying off the `.dark` class.
const resolveIsDark = (preference: ThemePreference) =>
  preference === 'dark' || (preference === 'system' && systemDarkQuery.matches);

// Both Tailwind (`darkMode: ['class', '.dark']`) and the ds-web tokens key off
// a `dark` class on <html>, so toggling it switches the whole app.
const applyPreference = (preference: ThemePreference) => {
  document.documentElement.classList.toggle('dark', resolveIsDark(preference));
};

const initialPreference = readStoredPreference();

interface ThemeState {
  preference: ThemePreference;
  // Effective dark/light after resolving 'system'; stays in sync with the OS.
  isDark: boolean;
  setPreference: (preference: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: initialPreference,
  isDark: resolveIsDark(initialPreference),
  setPreference: (preference) => {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
    applyPreference(preference);
    set({ preference, isDark: resolveIsDark(preference) });
  },
}));

applyPreference(useThemeStore.getState().preference);

// Follow live OS theme changes while in system mode.
systemDarkQuery.addEventListener('change', () => {
  if (useThemeStore.getState().preference !== 'system') return;
  applyPreference('system');
  useThemeStore.setState({ isDark: resolveIsDark('system') });
});
