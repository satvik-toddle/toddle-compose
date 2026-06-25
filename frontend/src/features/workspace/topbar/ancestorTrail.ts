import type { DocumentDto } from '../../../types/api';

export interface BreadcrumbSegment {
  id: string;
  title: string;
}

// Walks parentId up the loaded docs list to build the trail, ordered root -> current.
// Stops if an ancestor isn't loaded and guards against parentId cycles.
export function buildBreadcrumbTrail(
  doc: DocumentDto,
  docs: DocumentDto[],
): BreadcrumbSegment[] {
  const docsById = new Map(docs.map((d) => [d.id, d]));
  const trail: BreadcrumbSegment[] = [];
  const visited = new Set<string>();

  let current: DocumentDto | undefined = doc;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    trail.unshift({ id: current.id, title: current.title });
    current = current.parentId ? docsById.get(current.parentId) : undefined;
  }

  return trail;
}
