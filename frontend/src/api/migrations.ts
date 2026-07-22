import { http } from '../lib/http';
import type {
  CreateMigrationScopeInput,
  DocCodaMappingDto,
  EnqueueMigrationJobInput,
  MigrationJobDetail,
  MigrationJobSummary,
  MigrationMappingDto,
  MigrationScope,
  UpdateMigrationScopeInput,
  ValidateDestinationResult,
} from '../types/api';

export const migrationsApi = {
  // Destinations (scopes). workspaceId → that workspace's scopes (workspace ADMIN);
  // omitted → org-wide admin-console listing (realm admin).
  listScopes: (workspaceId?: string) =>
    http.get<MigrationScope[]>(
      `/migration-scopes${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`,
    ),
  createScope: (b: CreateMigrationScopeInput) => http.post<MigrationScope>('/migration-scopes', b),
  updateScope: (id: string, b: UpdateMigrationScopeInput) =>
    http.patch<MigrationScope>(`/migration-scopes/${id}`, b),
  removeScope: (id: string) => http.del<{ id: string }>(`/migration-scopes/${id}`),

  // Modal prefill — saved mappings for the selected scope, filtered to the docs in view.
  listMappings: (scopeId: string, docIds: string[]) =>
    http.get<MigrationMappingDto[]>(
      `/migration-scopes/${scopeId}/mappings?docIds=${encodeURIComponent(docIds.join(','))}`,
    ),

  // Per-row link check before enqueue — one in-scope Coda URL. The underlying Coda
  // reads funnel through the backend rate limiter, so concurrent per-row calls queue.
  validateDestination: (scopeId: string, url: string) =>
    http.post<ValidateDestinationResult>(
      `/migration-scopes/${scopeId}/validate-destination`,
      { url },
    ),

  // "Open in Coda" — a doc's live Coda destination(s) across its workspace's scopes.
  docCodaMappings: (docId: string) =>
    http.get<DocCodaMappingDto[]>(`/documents/${docId}/coda-mappings`),

  // Jobs (runs).
  enqueueJob: (scopeId: string, b: EnqueueMigrationJobInput) =>
    http.post<{ jobId: string }>(`/migration-scopes/${scopeId}/jobs`, b),
  listJobs: (params: { workspaceId?: string }) =>
    http.get<MigrationJobSummary[]>(
      `/migration-jobs${params.workspaceId ? `?workspaceId=${encodeURIComponent(params.workspaceId)}` : ''}`,
    ),
  getJob: (id: string) => http.get<MigrationJobDetail>(`/migration-jobs/${id}`),
  cancelJob: (id: string) => http.post<MigrationJobSummary>(`/migration-jobs/${id}/cancel`),
  retryJob: (id: string) => http.post<MigrationJobSummary>(`/migration-jobs/${id}/retry`),
};
