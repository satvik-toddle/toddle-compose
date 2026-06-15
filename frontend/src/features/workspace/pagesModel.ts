import type { DocumentDto, FolderDto } from '../../types/api';

export interface TreeFolder {
  id: string;
  name: string;
  icon: string;
  ownerId: string;
  folders: TreeFolder[];
  docs: DocumentDto[];
}

export interface PagesModel {
  rootFolders: TreeFolder[];
  rootDocs: DocumentDto[];
  docsByFolder: Map<string | null, DocumentDto[]>;
  isEmpty: boolean;
}

// Assemble a tree from the flat folder list + documents (grouped by folderId).
// Doc→doc sub-nesting (parentId) is folded to the folder level in this view.
export function buildPages(folders: FolderDto[], documents: DocumentDto[]): PagesModel {
  const docsByFolder = new Map<string | null, DocumentDto[]>();
  for (const d of documents) {
    const key = d.folderId;
    const arr = docsByFolder.get(key) ?? [];
    arr.push(d);
    docsByFolder.set(key, arr);
  }

  const nodeById = new Map<string, TreeFolder>();
  for (const f of folders) {
    nodeById.set(f.id, {
      id: f.id,
      name: f.name,
      icon: f.icon || '📁',
      ownerId: f.ownerId,
      folders: [],
      docs: docsByFolder.get(f.id) ?? [],
    });
  }

  const rootFolders: TreeFolder[] = [];
  for (const f of folders) {
    const node = nodeById.get(f.id)!;
    if (f.parentId && nodeById.has(f.parentId)) {
      nodeById.get(f.parentId)!.folders.push(node);
    } else {
      rootFolders.push(node);
    }
  }

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const byTitle = (a: DocumentDto, b: DocumentDto) => a.title.localeCompare(b.title);
  rootFolders.sort(byName);
  for (const n of nodeById.values()) {
    n.folders.sort(byName);
    n.docs.sort(byTitle);
  }
  const rootDocs = (docsByFolder.get(null) ?? []).slice().sort(byTitle);

  return {
    rootFolders,
    rootDocs,
    docsByFolder,
    isEmpty: folders.length === 0 && documents.length === 0,
  };
}
