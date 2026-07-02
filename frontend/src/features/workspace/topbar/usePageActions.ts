import { useNavigate } from 'react-router-dom';
import { useCreateDocument } from '../../../hooks/usePages';
import type { DocumentType } from '../../../types/api';

export function usePageActions(workspaceId: string) {
  const navigate = useNavigate();
  const createDoc = useCreateDocument();

  const newPage = (type?: DocumentType) =>
    createDoc.mutate(
      { workspaceId, title: 'Untitled', type },
      { onSuccess: (d) => navigate(`/w/${workspaceId}?doc=${d.id}`) },
    );

  const addSubPage = (parentId: string, type?: DocumentType) =>
    createDoc.mutate(
      { workspaceId, parentId, title: 'Untitled', type },
      { onSuccess: (d) => navigate(`/w/${workspaceId}?doc=${d.id}`) },
    );

  return { newPage, addSubPage, isPending: createDoc.isPending };
}
