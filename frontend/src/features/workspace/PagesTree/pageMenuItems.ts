import type { MenuItem } from '../../../components/ActionMenu';

// Builds the per-page row menu (the ⋯ actions). Each action is supplied by the
// caller, keeping this a pure mapping of permissions → menu entries.
export function buildPageMenuItems(opts: {
  canCreate: boolean;
  canManage: boolean;
  onAddSubpage: () => void;
  onRename: () => void;
  onDelete: () => void;
}): MenuItem[] {
  const items: MenuItem[] = [];
  if (opts.canCreate) {
    items.push({ key: 'subpage', label: 'Add sub-page', icon: 'AddOutlined', onSelect: opts.onAddSubpage });
  }
  if (opts.canManage) {
    items.push({ key: 'rename', label: 'Rename', icon: 'PencilOutlined', onSelect: opts.onRename });
    items.push({
      key: 'delete',
      label: 'Delete',
      icon: 'DeleteOutlined',
      danger: true,
      dividerBefore: true,
      onSelect: opts.onDelete,
    });
  }
  return items;
}
