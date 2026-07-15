import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCreateDocument, useDocuments } from '../../../../hooks/usePages';
import { useAuthStore } from '../../../../stores/authStore';
import { wsAtLeast } from '../../../../lib/roles';
import type { WorkspaceCtx } from '../../WorkspaceLayout';
import { buildDocTree, getAncestorIds, mapDocsById, type TreeDoc } from '../../pagesModel';
import type { DocumentType } from '../../../../types/api';
import type { WorkspaceRole } from '../../../../types/roles';

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

  // Scroll-sentinel hook-up: load the next docs page when the list bottom becomes visible.
  const loadMore = () => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  };

  // Pages start collapsed; this set tracks the ones explicitly expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const canCreate = wsAtLeast(ctx.role, 'EDIT');

  // Rebuild the tree only when the docs actually change (not on toggle/selection renders),
  // and thread the previous node index through so unchanged subtrees keep their identity —
  // that's what lets memoized PageRows skip re-rendering when pages append.
  const treeCache = useRef<Map<string, TreeDoc>>(new Map());
  const { roots, isEmpty } = useMemo(() => {
    const tree = buildDocTree(docs, treeCache.current);
    treeCache.current = tree.nodes;
    return tree;
  }, [docs]);
  const byId = useMemo(() => mapDocsById(docs), [docs]);

  // Reveal a deep-linked page (?doc=…) by expanding its ancestor spine on load.
  // We only ever add to the set, so the user's manual collapses aren't fought.
  useEffect(() => {
    if (!selectedPageId) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of getAncestorIds(selectedPageId, byId)) next.add(id);
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
    roots,
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
