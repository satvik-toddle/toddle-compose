import { http } from '../lib/http';
import type {
  CreateMigrationScopeInput,
  EnqueueMigrationJobInput,
  MigrationJobDetail,
  MigrationJobSummary,
  MigrationMappingDto,
  MigrationScope,
  UpdateMigrationScopeInput,
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
