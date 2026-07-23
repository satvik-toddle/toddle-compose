import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { codaImportApi } from '../api/codaImport';
import { messageOf } from '../lib/errors';
import { pushToast } from '../stores/uiStore';
import type { CreateCodaImportJobInput, MigrationJobStatus } from '../types/api';

// Runs still in flight — while any is in one of these, lists/detail poll.
const ACTIVE_JOB_STATUSES: MigrationJobStatus[] = ['QUEUED', 'RUNNING'];
const JOBS_POLL_MS = 3000;

const isActive = (status: MigrationJobStatus) => ACTIVE_JOB_STATUSES.includes(status);

// The stored Coda credentials the admin picks from (masked; realm-admin only).
export function useCodaImportCredentials(enabled = true) {
  return useQuery({
    queryKey: qk.codaImportCredentials,
    queryFn: () => codaImportApi.listCredentials(),
    enabled,
  });
}

// Modal step 1 — resolve a Coda URL to its doc name + page count via the picked
// credential's token. Fired on click, so a mutation (not a query); a bad/unreachable
// URL (or a token without access) surfaces as an error.
export function useValidateCodaImportUrl() {
  return useMutation({
    mutationFn: (v: { url: string; credentialId: string }) =>
      codaImportApi.validate(v.url, v.credentialId),
  });
}

export function useCreateCodaImportJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CreateCodaImportJobInput) => codaImportApi.createJob(b),
    onSuccess: () => {
      // The import creates a new workspace, so refresh both listings.
      qc.invalidateQueries({ queryKey: qk.codaImportJobs });
      qc.invalidateQueries({ queryKey: qk.workspaces });
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useCodaImportJobs(enabled = true) {
  return useQuery({
    queryKey: qk.codaImportJobs,
    queryFn: () => codaImportApi.listJobs(),
    enabled,
    refetchIntervalInBackground: false,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((job) => isActive(job.status)) ? JOBS_POLL_MS : false,
  });
}

// Cancel a QUEUED/RUNNING import; refresh the list + the affected job's detail.
export function useCancelCodaImportJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => codaImportApi.cancelJob(id),
    onSuccess: (job) => {
      qc.invalidateQueries({ queryKey: qk.codaImportJobs });
      qc.invalidateQueries({ queryKey: qk.codaImportJob(job.id) });
    },
    onError: (e) => pushToast({ kind: 'error', message: messageOf(e) }),
  });
}

export function useCodaImportJob(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? qk.codaImportJob(id) : ['codaImportJobs', 'detail', '_none'],
    queryFn: () => codaImportApi.getJob(id as string),
    enabled: !!id && enabled,
    refetchIntervalInBackground: false,
    refetchInterval: (query) =>
      query.state.data && isActive(query.state.data.status) ? JOBS_POLL_MS : false,
  });
}
