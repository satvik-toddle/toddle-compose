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
}

// Assemble the page tree from the flat document list, nesting by parentId.
export function buildDocTree(docs: DocumentDto[]): DocTree {
  const byId = new Map<string, TreeDoc>();
  for (const d of docs) byId.set(d.id, { doc: d, children: [] });

  const roots: TreeDoc[] = [];
  for (const d of docs) {
    const node = byId.get(d.id)!;
    const parent = d.parentId ? byId.get(d.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node); // no parent (or parent outside this list) → root page
  }

  const byTitle = (a: TreeDoc, b: TreeDoc) => a.doc.title.localeCompare(b.doc.title);
  const sortRec = (nodes: TreeDoc[]) => {
    nodes.sort(byTitle);
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);

  return { roots, isEmpty: docs.length === 0 };
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
