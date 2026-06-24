import { useMutation, useQueryClient } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { realmApi } from '../api/realm';
import { messageOf } from '../lib/errors';
import { pushToast } from '../stores/uiStore';
import type { RealmMember } from '../types/api';
import type { RealmRole } from '../types/roles';

type AssignableRealmRole = Exclude<RealmRole, 'OWNER'>;

export function useAddRealmMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { email: string; role: AssignableRealmRole }) => realmApi.addUser(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.realmMembers }),
  });
}

export function useSetRealmRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; role: AssignableRealmRole }) =>
      realmApi.setRole(v.userId, v.role),
    onMutate: async ({ userId, role }) => {
      await qc.cancelQueries({ queryKey: qk.realmMembers });
      const prev = qc.getQueryData<RealmMember[]>(qk.realmMembers);
      qc.setQueryData<RealmMember[]>(qk.realmMembers, (old) =>
        old?.map((m) => (m.userId === userId ? { ...m, role } : m)),
      );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.realmMembers, ctx.prev);
      pushToast({ kind: 'error', message: messageOf(e) });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.realmMembers }),
  });
}

export function useUpdateRealmSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { allowedEmailDomains: string[] }) => realmApi.updateSettings(b),
    onSuccess: (realm) => {
      qc.setQueryData(qk.realm, realm);
      pushToast({ kind: 'success', message: 'Realm settings saved.' });
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useRemoveRealmMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => realmApi.removeUser(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.realmMembers }),
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}
