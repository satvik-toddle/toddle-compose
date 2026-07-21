import { BadRequestException } from "@nestjs/common";
import type { CodaAuth, CodaClient } from "../coda/coda.client";

// A destination/target URL resolved to a real Coda resource. Only "doc" and
// "page" are acceptable roots/targets (H5); anything else (table/row/…) rejects.
export interface ResolvedTarget {
  kind: "doc" | "page";
  docId: string;
  // Page id for a page resource; null for a whole-doc resource.
  pageId: string | null;
  // Canonical browser URL from Coda (falls back to the input URL).
  canonicalUrl: string;
}

// Extract the doc id from an API href like
// https://coda.io/apis/v1/docs/{docId}[/pages/{pageId}].
export function parseDocIdFromHref(href: string | undefined): string | null {
  if (!href) return null;
  const m = href.match(/\/docs\/([^/?#]+)/);
  return m ? m[1] : null;
}

// Resolve a browser URL to a doc or page target, asserting resource.type (H5)
// and deriving the doc id. Throws 400 (never silently) on any unusable link.
export async function resolveTarget(
  coda: CodaClient,
  auth: CodaAuth,
  url: string,
): Promise<ResolvedTarget> {
  let resource;
  try {
    resource = await coda.resolveBrowserLink(auth, url);
  } catch {
    throw new BadRequestException(`could not resolve Coda URL: ${url}`);
  }

  const canonicalUrl = resource.browserLink ?? url;

  if (resource.type === "doc") {
    const docId = resource.id || parseDocIdFromHref(resource.href);
    if (!docId) throw new BadRequestException(`could not derive doc id from ${url}`);
    return { kind: "doc", docId, pageId: null, canonicalUrl };
  }

  if (resource.type === "page") {
    const docId = parseDocIdFromHref(resource.href);
    if (!docId) throw new BadRequestException(`could not derive doc id from ${url}`);
    return { kind: "page", docId, pageId: resource.id, canonicalUrl };
  }

  throw new BadRequestException(
    `Coda URL must point to a doc or a page, got "${resource.type}": ${url}`,
  );
}
