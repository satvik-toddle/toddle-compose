import { arrayMove } from '@dnd-kit/sortable';
import type { DocumentDto, DocumentType } from '../../types/api';

// One editable-tree row: a DOC node whose `parentId` is its arranged parent (null = top-level) for `plannedParentDocId`.
export interface MigrationFlatItem {
  id: string;
  parentId: string | null;
  depth: number;
  title: string;
  type: DocumentType;
}

// The DOC-only, SHEET-filtered subtree seed plus how many SHEETs were dropped.
export interface MigrationSeed {
  items: MigrationFlatItem[];
  skippedSheets: number;
}

// Collect the doc + descendants, drop SHEETs, re-anchor survivors to their nearest in-subtree DOC ancestor; depth-first.
export function buildMigrationSeed(docs: DocumentDto[], rootId: string): MigrationSeed {
  const byId = new Map<string, DocumentDto>(docs.map((d) => [d.id, d]));
  const childrenOf = new Map<string, DocumentDto[]>();
  for (const d of docs) {
    if (!d.parentId) continue;
    const list = childrenOf.get(d.parentId) ?? [];
    list.push(d);
    childrenOf.set(d.parentId, list);
  }

  // The original subtree (root + all descendants), as an id set.
  const inSubtree = new Set<string>();
  const walk = (id: string) => {
    if (inSubtree.has(id)) return;
    inSubtree.add(id);
    for (const child of childrenOf.get(id) ?? []) walk(child.id);
  };
  walk(rootId);

  const root = byId.get(rootId);
  let skippedSheets = 0;
  for (const id of inSubtree) {
    if (byId.get(id)?.type === 'SHEET') skippedSheets += 1;
  }

  // Nearest DOC ancestor inside the subtree (skipping filtered SHEETs); null when
  // the walk leaves the subtree or reaches the root's parent.
  const arrangedParent = (doc: DocumentDto): string | null => {
    let cur = doc.parentId;
    while (cur && inSubtree.has(cur) && doc.id !== rootId) {
      const parent = byId.get(cur);
      if (!parent) return null;
      if (parent.type === 'DOC') return parent.id;
      cur = parent.parentId;
    }
    return null;
  };

  // Group surviving DOC nodes under their arranged parent, then emit depth-first
  // with titles sorted so the tree reads like the sidebar.
  const docChildren = new Map<string | null, DocumentDto[]>();
  for (const id of inSubtree) {
    const doc = byId.get(id);
    if (!doc || doc.type !== 'DOC') continue;
    const key = doc.id === rootId ? null : arrangedParent(doc);
    const list = docChildren.get(key) ?? [];
    list.push(doc);
    docChildren.set(key, list);
  }

  const items: MigrationFlatItem[] = [];
  const emit = (parentId: string | null, depth: number) => {
    const nodes = (docChildren.get(parentId) ?? []).sort((a, b) =>
      a.title.localeCompare(b.title),
    );
    for (const doc of nodes) {
      items.push({ id: doc.id, parentId, depth, title: doc.title, type: doc.type });
      emit(doc.id, depth + 1);
    }
  };
  // If the root is a DOC it is the sole top-level node; otherwise its DOC children float up.
  if (root?.type === 'DOC') {
    items.push({ id: root.id, parentId: null, depth: 0, title: root.title, type: root.type });
    emit(root.id, 1);
  } else {
    emit(null, 0);
  }

  return { items, skippedSheets };
}

// --- dnd-kit flatten/build round trip (canonical sortable-tree helpers) ------

interface NestedItem extends MigrationFlatItem {
  children: NestedItem[];
}

// Re-nest a flat ordered list by parentId, preserving sibling order.
function buildTree(flat: MigrationFlatItem[]): NestedItem[] {
  const nodes = new Map<string, NestedItem>();
  const roots: NestedItem[] = [];
  for (const item of flat) nodes.set(item.id, { ...item, children: [] });
  for (const item of flat) {
    const node = nodes.get(item.id)!;
    const parent = item.parentId ? nodes.get(item.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

// Flatten a nested tree back to a depth-first ordered list with recomputed depth.
function flattenTree(nodes: NestedItem[], parentId: string | null, depth: number): MigrationFlatItem[] {
  const out: MigrationFlatItem[] = [];
  for (const node of nodes) {
    out.push({ id: node.id, parentId, depth, title: node.title, type: node.type });
    out.push(...flattenTree(node.children, node.id, depth + 1));
  }
  return out;
}

// Drop rows that are descendants of any id in `ids` (used to hide the dragged
// subtree so a node can't be dropped inside itself).
export function removeChildrenOf(items: MigrationFlatItem[], ids: string[]): MigrationFlatItem[] {
  const excluded = new Set(ids);
  return items.filter((item) => {
    if (item.parentId && excluded.has(item.parentId)) {
      excluded.add(item.id);
      return false;
    }
    return true;
  });
}

const getDragDepth = (offset: number, indentationWidth: number) =>
  Math.round(offset / indentationWidth);

// Project the drop target's depth + parent from the horizontal drag offset, clamped between prev (max) and next (min) rows.
export function getProjection(
  items: MigrationFlatItem[],
  activeId: string,
  overId: string,
  dragOffset: number,
  indentationWidth: number,
): { depth: number; parentId: string | null } {
  const overIndex = items.findIndex((i) => i.id === overId);
  const activeIndex = items.findIndex((i) => i.id === activeId);
  const activeItem = items[activeIndex];
  const newItems = arrayMove(items, activeIndex, overIndex);
  const previousItem = newItems[overIndex - 1];
  const nextItem = newItems[overIndex + 1];
  const projectedDepth = activeItem.depth + getDragDepth(dragOffset, indentationWidth);
  const maxDepth = previousItem ? previousItem.depth + 1 : 0;
  const minDepth = nextItem ? nextItem.depth : 0;

  let depth = projectedDepth;
  if (projectedDepth >= maxDepth) depth = maxDepth;
  else if (projectedDepth < minDepth) depth = minDepth;

  const parentId = (() => {
    if (depth === 0 || !previousItem) return null;
    if (depth === previousItem.depth) return previousItem.parentId;
    if (depth > previousItem.depth) return previousItem.id;
    const candidate = newItems
      .slice(0, overIndex)
      .reverse()
      .find((i) => i.depth === depth);
    return candidate?.parentId ?? null;
  })();

  return { depth, parentId };
}

// Apply a drag result: retarget the active node's parent/depth, move it to the
// drop index, then rebuild the tree so its subtree follows and depths are correct.
export function applyDrag(
  items: MigrationFlatItem[],
  activeId: string,
  overId: string,
  projection: { depth: number; parentId: string | null },
): MigrationFlatItem[] {
  const activeIndex = items.findIndex((i) => i.id === activeId);
  const overIndex = items.findIndex((i) => i.id === overId);
  const clone = items.map((i) =>
    i.id === activeId ? { ...i, depth: projection.depth, parentId: projection.parentId } : i,
  );
  const moved = arrayMove(clone, activeIndex, overIndex);
  return flattenTree(buildTree(moved), null, 0);
}
