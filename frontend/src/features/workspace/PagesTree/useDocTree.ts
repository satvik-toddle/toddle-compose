import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCreateDocument, useDocuments } from '../../../hooks/usePages';
import { useAuthStore } from '../../../stores/authStore';
import { wsAtLeast } from '../../../lib/roles';
import type { WorkspaceCtx } from '../WorkspaceLayout';
import { buildDocTree, getAncestorIds, mapDocsById } from '../pagesModel';

// Owns the page tree's data + interaction state for a workspace: builds the tree,
// tracks which pages are expanded (auto-revealing a deep-linked page's ancestors),
// and exposes the navigation/create handlers the rows need. The recursive rows
// receive this whole controller, so they don't each reach into stores/router.
export function useDocTree(ctx: WorkspaceCtx) {
  const ws = ctx.workspaceId;
  const me = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const selDoc = params.get('doc');

  const { data: docs = [], isLoading } = useDocuments(ws);
  const createDoc = useCreateDocument();

  // Pages start collapsed; this set tracks the ones explicitly expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const canCreate = wsAtLeast(ctx.role, 'EDIT');

  const { roots, isEmpty } = buildDocTree(docs);
  const byId = useMemo(() => mapDocsById(docs), [docs]);

  // Reveal a deep-linked page (?doc=…) by expanding its ancestor spine on load.
  // We only ever add to the set, so the user's manual collapses aren't fought.
  useEffect(() => {
    if (!selDoc) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of getAncestorIds(selDoc, byId)) next.add(id);
      return next;
    });
  }, [selDoc, byId]);

  const selectDoc = (id: string) => navigate(`/w/${ws}?doc=${id}`);

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Create a page (optionally under a parent), expand that parent so the new page
  // is visible, and open the page once it's created.
  const createPage = (parentId?: string) => {
    if (parentId) setExpanded((s) => (s.has(parentId) ? s : new Set(s).add(parentId)));
    createDoc.mutate(
      { workspaceId: ws, parentId, title: 'Untitled' },
      { onSuccess: (d) => selectDoc(d.id) },
    );
  };

  const canManage = (ownerId: string) => ctx.isAdmin || me?.id === ownerId;

  return {
    ws,
    isLoading,
    roots,
    isEmpty,
    selDoc,
    expanded,
    canCreate,
    toggle,
    selectDoc,
    createPage,
    canManage,
  };
}

export type DocTreeController = ReturnType<typeof useDocTree>;
