import { http } from '../lib/http';
import type {
  CodaImportCredentialView,
  CodaImportJobDetail,
  CodaImportJobSummary,
  CodaImportValidateResult,
  CreateCodaImportJobInput,
  CreateCodaImportJobResult,
} from '../types/api';


// "Import from Coda" — realm-admin gated. Each import resolves a Coda doc, creates
// a NEW workspace, and runs against the one credential the admin picks for the job.
export const codaImportApi = {
  // Resolve a Coda URL to its doc name + page count for the modal's confirm step,
  // reading Coda through the picked credential's token.
  validate: (url: string, credentialId: string) =>
    http.get<CodaImportValidateResult>(
      `/admin/coda-import/validate?url=${encodeURIComponent(url)}&credentialId=${encodeURIComponent(credentialId)}`,
    ),
  createJob: (b: CreateCodaImportJobInput) =>
    http.post<CreateCodaImportJobResult>('/admin/coda-import/jobs', b),
  listCredentials: () =>
    http.get<CodaImportCredentialView[]>('/admin/coda-import/credentials'),
  listJobs: () => http.get<CodaImportJobSummary[]>('/admin/coda-import/jobs'),
  getJob: (id: string) => http.get<CodaImportJobDetail>(`/admin/coda-import/jobs/${id}`),
  // Stop a QUEUED/RUNNING import; returns the updated summary.
  cancelJob: (id: string) =>
    http.post<CodaImportJobSummary>(`/admin/coda-import/jobs/${id}/cancel`),
};
