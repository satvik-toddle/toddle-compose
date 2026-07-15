import type { DocumentDto } from '../../types/api';

// Coda/Notion model: every page is a document, and a "folder" is just a page that
// has child pages. We build the page tree purely from `parentId` (a page with no
// parent is a root page). The legacy Folder model is unused here.
export interface TreeDoc {
  doc: DocumentDto;
  children: TreeDoc[];
}

export interface DocTree {
  roots: TreeDoc[];
  isEmpty: boolean;
  // Node index for the NEXT build's structural sharing (pass back as prevNodes).
  nodes: Map<string, TreeDoc>;
}

// Assemble the page tree from the flat document list, nesting by parentId. `prevNodes` (the
// prior build's node index) enables structural sharing so memoized rows skip unchanged subtrees.
export function buildDocTree(
  docs: DocumentDto[],
  prevNodes?: Map<string, TreeDoc>
): DocTree {
  const byId = new Map<string, TreeDoc>();
  for (const d of docs) byId.set(d.id, { doc: d, children: [] });

  const roots: TreeDoc[] = [];
  for (const d of docs) {
    const node = byId.get(d.id)!;
    const parent = d.parentId ? byId.get(d.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node); // no parent (or parent outside this list) → root page
  }

  // Sort by the SAME key the server paginates by (updatedAt desc, id tiebreaker) so a
  // lazily loaded next page appends below what's shown instead of scattering by title.
  const byRecency = (a: TreeDoc, b: TreeDoc) =>
    b.doc.updatedAt.localeCompare(a.doc.updatedAt) || b.doc.id.localeCompare(a.doc.id);
  const sortRec = (nodes: TreeDoc[]) => {
    nodes.sort(byRecency);
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);

  // Bottom-up identity reconciliation against the previous build.
  const nodes = new Map<string, TreeDoc>();
  const reuse = (node: TreeDoc): TreeDoc => {
    const children = node.children.map(reuse);
    const prev = prevNodes?.get(node.doc.id);
    const unchanged =
      prev &&
      prev.doc === node.doc &&
      prev.children.length === children.length &&
      prev.children.every((c, i) => c === children[i]);
    const out = unchanged ? prev : node;
    if (!unchanged) out.children = children;
    nodes.set(out.doc.id, out);
    return out;
  };
  const sharedRoots = roots.map(reuse);

  return { roots: sharedRoots, isEmpty: docs.length === 0, nodes };
}

// Index the flat document list by id, for parent/ancestor lookups.
export function mapDocsById(docs: DocumentDto[]): Map<string, DocumentDto> {
  return new Map(docs.map((d) => [d.id, d]));
}

// Walk a page's parent spine (the page itself up to its root), returning the ids.
// Used to reveal a deep-linked page by expanding its ancestors.
export function getAncestorIds(docId: string, byId: Map<string, DocumentDto>): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  let cur: string | null | undefined = docId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    ids.push(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return ids;
}
