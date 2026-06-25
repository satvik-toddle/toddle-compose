import type { ReactElement } from 'react';
import { AddOutlined, DeleteOutlined, PencilOutlined } from '@toddle-edu/ds-icons';

// One entry in the per-page (⋯) actions menu, shaped for ds-web DropdownMenu options.
export interface PageMenuOption {
  key: string;
  label?: string;
  icon?: ReactElement;
  isDivider?: boolean;
  isDestructive?: boolean;
  onSelect?: () => void;
}

// Builds the per-page row menu from the caller's permissions + handlers, as a pure
// mapping of permissions → ds-web DropdownMenu options.
export function buildPageMenuItems(opts: {
  canCreate: boolean;
  canManage: boolean;
  onAddSubpage: () => void;
  onRename: () => void;
  onDelete: () => void;
}): PageMenuOption[] {
  const items: PageMenuOption[] = [];
  if (opts.canCreate) {
    items.push({
      key: 'subpage',
      label: 'Add sub-page',
      icon: <AddOutlined size="xx-small" />,
      onSelect: opts.onAddSubpage,
    });
  }
  if (opts.canManage) {
    items.push(
      {
        key: 'rename',
        label: 'Rename',
        icon: <PencilOutlined size="xx-small" />,
        onSelect: opts.onRename,
      },
      { key: 'delete-divider', isDivider: true },
      {
        key: 'delete',
        label: 'Delete',
        icon: <DeleteOutlined size="xx-small" />,
        isDestructive: true,
        onSelect: opts.onDelete,
      },
    );
  }
  return items;
}
