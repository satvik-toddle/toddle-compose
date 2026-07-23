// Request/response shapes for the subset of the Coda REST API this client uses.
// Field names follow the Coda OpenAPI spec (coda.io/apis/v1/openapi.json).

// A resolved resource pointed at by a browser link (H5: may be a doc/table/row,
// not always a page — the caller asserts `type === "page"`).
export interface CodaResource {
  type: string;
  id: string;
  name?: string;
  href?: string;
  browserLink?: string;
}

export interface ResolveBrowserLinkResponse {
  type: string;
  href?: string;
  browserLink?: string;
  resource: CodaResource;
}

// Lightweight page pointer (parent/children references carry no ancestry, H6).
export interface CodaPageRef {
  id: string;
  type?: string;
  name?: string;
  href?: string;
  browserLink?: string;
}

// Full page as returned by GET /docs/{docId}/pages/{pageId}. Only the immediate
// `parent` is present — there is no ancestor array (H6).
export interface CodaPage {
  id: string;
  type?: string;
  name: string;
  subtitle?: string;
  parent?: CodaPageRef;
  children?: CodaPageRef[];
  href?: string;
  browserLink?: string;
}

// A Coda doc as returned by GET /docs/{docId}. Fetched to confirm a token can
// access a whole-doc scope destination (no root page to read).
export interface CodaDoc {
  id: string;
  type?: string;
  name?: string;
  href?: string;
  browserLink?: string;
}

// Canvas content payload shared by create/replace/append (constrained HTML, H4).
export type CanvasContentFormat = "html" | "markdown";

export interface CanvasContent {
  format: CanvasContentFormat;
  content: string;
}

export interface CreatePageInput {
  name: string;
  subtitle?: string;
  parentPageId?: string;
  html: string;
}

// How new canvas content merges into an existing page.
export type PageContentInsertionMode = "append" | "replace";

// Async-mutation acknowledgement: the write is queued, not applied (H2).
export interface CodaMutationResponse {
  id: string;
  requestId: string;
}

export interface CodaMutationStatus {
  completed: boolean;
  // Present (and non-null) when the mutation failed on Coda's side.
  warning?: string | null;
}

export interface AwaitMutationOptions {
  timeoutMs?: number;
  pollMs?: number;
}

// One page of a Coda list response (GET /docs/{docId}/pages). The full page tree
// is reconstructed by the caller from each page's `parent` ref (H6).
export interface CodaPageList {
  items: CodaPage[];
  href?: string;
  nextPageToken?: string;
  nextPageLink?: string;
}

export type CodaExportStatusValue = "inProgress" | "complete" | "failed";

// Acknowledgement of a page-export request (POST .../pages/{pageId}/export).
export interface CodaExportBegin {
  id: string;
  status: CodaExportStatusValue;
  href: string;
}

// Poll response for an in-flight export; `downloadLink` (a signed URL) appears
// once `status === "complete"`.
export interface CodaExportStatus {
  id: string;
  status: CodaExportStatusValue;
  href: string;
  downloadLink?: string;
}

export interface ExportPageOptions {
  timeoutMs?: number;
  pollMs?: number;
}
