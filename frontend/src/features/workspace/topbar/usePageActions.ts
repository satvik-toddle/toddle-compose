import { useNavigate } from 'react-router-dom';
import { useCreateDocument } from '../../../hooks/usePages';

export function usePageActions(workspaceId: string) {
  const navigate = useNavigate();
  const createDoc = useCreateDocument();

  const newPage = () =>
    createDoc.mutate(
      { workspaceId, title: 'Untitled' },
      { onSuccess: (d) => navigate(`/w/${workspaceId}?doc=${d.id}`) },
    );

  const addSubPage = (parentId: string) =>
    createDoc.mutate(
      { workspaceId, parentId, title: 'Untitled' },
      { onSuccess: (d) => navigate(`/w/${workspaceId}?doc=${d.id}`) },
    );

  return { newPage, addSubPage, isPending: createDoc.isPending };
}
