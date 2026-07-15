import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCreateDocument, useDocuments } from '../../../../hooks/usePages';
import { useAuthStore } from '../../../../stores/authStore';
import { wsAtLeast } from '../../../../lib/roles';
import type { WorkspaceCtx } from '../../WorkspaceLayout';
import { buildDocTree, getAncestorIds, mapDocsById, type TreeDoc } from '../../pagesModel';
import type { DocumentType } from '../../../../types/api';
import type { WorkspaceRole } from '../../../../types/roles';

// One visible row in the flattened, virtualized page list.
export interface FlatRow {
  node: TreeDoc;
  depth: number;
}

// Owns the pages section's data + interaction state for a workspace: builds the
// page hierarchy, tracks which pages are expanded (auto-revealing a deep-linked
// page's ancestors), and exposes the navigation/create handlers the rows need. The
// recursive rows receive this whole controller, so they don't each reach into
// stores/router.
export function usePagesSection(ctx: WorkspaceCtx) {
  const ws = ctx.workspaceId;
  const currentUser = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const selectedPageId = params.get('doc');

  const {
    data: docs = [],
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDocuments(ws);
  const createDoc = useCreateDocument();

  // Loads the next docs page when the sidebar nears its scroll bottom (driven by PagesSection).
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Pages start collapsed; this set tracks the ones explicitly expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const canCreate = wsAtLeast(ctx.role, 'EDIT');

  // Rebuild the tree only when docs change, threading the previous node index for structural
  // sharing. The cache is READ during render but WRITTEN in an effect (commit phase) so the
  // render stays pure — StrictMode/concurrent double-invokes then reconcile against the same
  // committed set instead of one just mutated mid-render.
  const treeCache = useRef<Map<string, TreeDoc>>(new Map());
  const tree = useMemo(() => buildDocTree(docs, treeCache.current), [docs]);
  useEffect(() => {
    treeCache.current = tree.nodes;
  }, [tree]);
  const { roots, isEmpty } = tree;
  const byId = useMemo(() => mapDocsById(docs), [docs]);

  // Flatten the tree into the linear list of currently-VISIBLE rows (a node is visible when
  // every ancestor is expanded). This is what the sidebar virtualizes. Recomputed only when
  // the tree or the expanded set changes — NOT on selection — so selecting a doc doesn't
  // re-flatten and the virtual window re-renders just the ~visible rows.
  const flattened = useMemo(() => {
    const out: FlatRow[] = [];
    const walk = (nodes: TreeDoc[], depth: number) => {
      for (const n of nodes) {
        out.push({ node: n, depth });
        if (n.children.length > 0 && expanded.has(n.doc.id)) walk(n.children, depth + 1);
      }
    };
    walk(roots, 0);
    return out;
  }, [roots, expanded]);

  // Reveal a deep-linked page (?doc=…) by expanding its ancestor spine on load; only ever
  // adds, so manual collapses aren't fought. Returns the same set when nothing new is added,
  // so a docs-page append (byId changes) doesn't trigger a pointless re-render.
  useEffect(() => {
    if (!selectedPageId) return;
    setExpanded((prev) => {
      const ids = getAncestorIds(selectedPageId, byId);
      if (ids.every((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, [selectedPageId, byId]);

  // Stable handler identities: memoized PageRows compare these, so an unstable identity
  // would defeat the whole memoization.
  const selectPage = useCallback((id: string) => navigate(`/w/${ws}?doc=${id}`), [navigate, ws]);

  const toggle = useCallback(
    (id: string) =>
      setExpanded((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  // Create a page (optionally under a parent), expand that parent so the new page
  // is visible, and open the page once it's created.
  const createDocMutate = createDoc.mutate; // stable across renders (the result object isn't)
  const createPage = useCallback(
    (parentId?: string, type?: DocumentType) => {
      if (parentId) setExpanded((s) => (s.has(parentId) ? s : new Set(s).add(parentId)));
      createDocMutate(
        { workspaceId: ws, parentId, title: 'Untitled', type },
        { onSuccess: (d) => selectPage(d.id) },
      );
    },
    [ws, createDocMutate, selectPage],
  );

  const canManage = useCallback(
    (ownerId: string, myRole?: WorkspaceRole | null) =>
      ctx.isAdmin || currentUser?.id === ownerId || myRole === 'ADMIN',
    [ctx.isAdmin, currentUser?.id],
  );

  return {
    ws,
    isLoading,
    flattened,
    isEmpty,
    selectedPageId,
    expanded,
    canCreate,
    toggle,
    selectPage,
    createPage,
    canManage,
    loadMore,
    hasMore: hasNextPage ?? false,
    isLoadingMore: isFetchingNextPage,
  };
}

export type PagesSectionController = ReturnType<typeof usePagesSection>;
