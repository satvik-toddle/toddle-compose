import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { postAuthMessage, subscribeAuthMessages } from '../lib/tabSync';
import type { AuthResponse, User } from '../types/api';
import type { WorkspaceRole } from '../types/roles';

export type AuthStatus = 'loading' | 'authed' | 'anon';

interface AuthState {
  status: AuthStatus;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null; // epoch ms
  user: User | null;
  // Active workspace scope — the single source of truth (mirrors the access
  // token's activeWorkspaceId claim). `lastActiveWorkspaceId` is persisted so we
  // can restore scope after a cold boot / refresh.
  activeWorkspaceId: string | null;
  activeRole: WorkspaceRole | null;
  lastActiveWorkspaceId: string | null;

  setStatus: (status: AuthStatus) => void;
  setSession: (res: AuthResponse) => void;
  applyTokens: (
    t: { accessToken: string; refreshToken?: string; expiresIn: number },
    user?: User,
  ) => void;
  setUser: (user: User) => void;
  setScope: (workspaceId: string, role: WorkspaceRole) => void;
  // Deliberate leave (clears the remembered workspace too).
  leaveScope: () => void;
  // Removed/demoted mid-session: drop scope but keep the session.
  clearScopeLocal: () => void;
  clearSession: () => void;
}

// When applying tokens that arrived FROM another tab, don't echo them back.
let suppressBroadcast = false;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      status: 'loading',
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      user: null,
      activeWorkspaceId: null,
      activeRole: null,
      lastActiveWorkspaceId: null,

      setStatus: (status) => set({ status }),

      setSession: (res) => {
        set({
          status: 'authed',
          accessToken: res.accessToken,
          refreshToken: res.refreshToken,
          expiresAt: Date.now() + res.expiresIn * 1000,
          user: res.user,
        });
        if (!suppressBroadcast) {
          postAuthMessage({
            type: 'tokens',
            accessToken: res.accessToken,
            refreshToken: res.refreshToken,
            expiresIn: res.expiresIn,
            user: res.user,
          });
        }
      },

      applyTokens: (t, user) => {
        const refreshToken = t.refreshToken ?? get().refreshToken;
        set({
          status: 'authed',
          accessToken: t.accessToken,
          refreshToken,
          expiresAt: Date.now() + t.expiresIn * 1000,
          ...(user ? { user } : {}),
        });
        if (!suppressBroadcast && refreshToken) {
          postAuthMessage({
            type: 'tokens',
            accessToken: t.accessToken,
            refreshToken,
            expiresIn: t.expiresIn,
            user: user ?? get().user ?? undefined,
          });
        }
      },

      setUser: (user) => set({ user }),

      setScope: (workspaceId, role) =>
        set({
          activeWorkspaceId: workspaceId,
          activeRole: role,
          lastActiveWorkspaceId: workspaceId,
        }),

      leaveScope: () =>
        set({ activeWorkspaceId: null, activeRole: null, lastActiveWorkspaceId: null }),

      clearScopeLocal: () =>
        set({ activeWorkspaceId: null, activeRole: null, lastActiveWorkspaceId: null }),

      clearSession: () => {
        set({
          status: 'anon',
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
          user: null,
          activeWorkspaceId: null,
          activeRole: null,
          lastActiveWorkspaceId: null,
        });
        if (!suppressBroadcast) postAuthMessage({ type: 'logout' });
      },
    }),
    {
      name: 'tc-auth',
      // Persist only the durable bits; the access token is short-lived and
      // re-minted on boot via refresh.
      partialize: (s) => ({
        refreshToken: s.refreshToken,
        lastActiveWorkspaceId: s.lastActiveWorkspaceId,
      }),
    },
  ),
);

// Adopt auth changes broadcast by sibling tabs (without re-broadcasting).
subscribeAuthMessages((msg) => {
  suppressBroadcast = true;
  try {
    const s = useAuthStore.getState();
    if (msg.type === 'logout') {
      s.clearSession();
    } else if (msg.type === 'tokens') {
      s.applyTokens(
        { accessToken: msg.accessToken, refreshToken: msg.refreshToken, expiresIn: msg.expiresIn },
        msg.user as User | undefined,
      );
    }
  } finally {
    suppressBroadcast = false;
  }
});

// Non-React accessors for the http layer.
export const authState = () => useAuthStore.getState();
