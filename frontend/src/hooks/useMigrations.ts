import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { migrationsApi } from '../api/migrations';
import { messageOf } from '../lib/errors';
import { pushToast } from '../stores/uiStore';
import type {
  CreateMigrationScopeInput,
  EnqueueMigrationJobInput,
  MigrationJobStatus,
  MigrationJobSummary,
  UpdateMigrationScopeInput,
} from '../types/api';

// Jobs still in flight — while any run is in one of these the lists/detail poll.
const ACTIVE_JOB_STATUSES: MigrationJobStatus[] = ['QUEUED', 'RUNNING'];
const JOBS_POLL_MS = 3000;

const isActive = (status: MigrationJobStatus) => ACTIVE_JOB_STATUSES.includes(status);

// ---- Destinations (scopes) -------------------------------------------------

export function useMigrationScopes(workspaceId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.migrationScopes(workspaceId),
    queryFn: () => migrationsApi.listScopes(workspaceId),
    enabled,
  });
}

export function useCreateScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CreateMigrationScopeInput) => migrationsApi.createScope(b),
    onSuccess: (scope) => {
      qc.invalidateQueries({ queryKey: qk.migrationScopes(scope.workspaceId) });
      qc.invalidateQueries({ queryKey: qk.migrationScopes() });
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useUpdateScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: UpdateMigrationScopeInput }) =>
      migrationsApi.updateScope(v.id, v.body),
    onSuccess: (scope) => {
      qc.invalidateQueries({ queryKey: qk.migrationScopes(scope.workspaceId) });
      qc.invalidateQueries({ queryKey: qk.migrationScopes() });
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useDeleteScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => migrationsApi.removeScope(id),
    onSuccess: () => {
      // The delete response carries only { id }, so refresh every scopes listing.
      qc.invalidateQueries({ queryKey: ['migrationScopes'] });
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

// ---- Modal prefill (saved mappings) ----------------------------------------

export function useMigrationMappings(scopeId: string | undefined, docIds: string[]) {
  return useQuery({
    queryKey: scopeId
      ? qk.migrationMappings(scopeId, docIds)
      : ['migrationScopes', '_none', 'mappings'],
    queryFn: () => migrationsApi.listMappings(scopeId as string, docIds),
    enabled: !!scopeId && docIds.length > 0,
  });
}

// ---- Open in Coda (a doc's live destinations) ------------------------------

// A doc's saved Coda destination(s), gated to workspace editor+. Fetched lazily
// (pass enabled=false until needed, e.g. the row's menu opens) so it doesn't run
// a query per doc row up front.
export function useDocCodaMappings(docId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: docId ? qk.docCodaMappings(docId) : ['migrationScopes', 'docMappings', '_none'],
    queryFn: () => migrationsApi.docCodaMappings(docId as string),
    enabled: !!docId && enabled,
  });
}

// ---- Jobs (runs) -----------------------------------------------------------

export function useEnqueueMigration(scopeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: EnqueueMigrationJobInput) => migrationsApi.enqueueJob(scopeId, b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['migrationJobs'] });
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useMigrationJobs(params: { workspaceId?: string }, enabled = true) {
  return useQuery({
    queryKey: qk.migrationJobs(params),
    queryFn: () => migrationsApi.listJobs(params),
    enabled,
    refetchIntervalInBackground: false,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((job: MigrationJobSummary) => isActive(job.status))
        ? JOBS_POLL_MS
        : false,
  });
}

export function useMigrationJob(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? qk.migrationJob(id) : ['migrationJobs', 'detail', '_none'],
    queryFn: () => migrationsApi.getJob(id as string),
    enabled: !!id && enabled,
    refetchIntervalInBackground: false,
    refetchInterval: (query) =>
      query.state.data && isActive(query.state.data.status) ? JOBS_POLL_MS : false,
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => migrationsApi.cancelJob(id),
    onSuccess: (job) => {
      qc.invalidateQueries({ queryKey: ['migrationJobs'] });
      qc.invalidateQueries({ queryKey: qk.migrationJob(job.id) });
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useRetryJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => migrationsApi.retryJob(id),
    onSuccess: (job) => {
      qc.invalidateQueries({ queryKey: ['migrationJobs'] });
      qc.invalidateQueries({ queryKey: qk.migrationJob(job.id) });
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}
