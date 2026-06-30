import type { ReactElement } from 'react';
import {
  AddOutlined,
  ArrowOutOutlined,
  DeleteOutlined,
  LinkOutlined,
  PageAPlusOutlined,
  PencilOutlined,
  StarFilled,
  StarOutlined,
} from '@toddle-edu/ds-icons';

// One entry in the per-page (⋯) actions menu, shaped for ds-web DropdownMenu options.
export interface PageMenuOption {
  key: string;
  label?: string;
  icon?: ReactElement;
  isDivider?: boolean;
  isDestructive?: boolean;
  onSelect?: () => void;
}

// Builds the per-page (⋯) menu from permissions + handlers: create actions, then
// personal actions plus rename, with destructive delete last.
export function buildPageMenuItems(opts: {
  canCreate: boolean;
  canManage: boolean;
  isStarred: boolean;
  onAddSubpage: () => void;
  onAddPage: () => void;
  onToggleStar: () => void;
  onCopyLink: () => void;
  onOpenInNewTab: () => void;
  onRename: () => void;
  onDelete: () => void;
}): PageMenuOption[] {
  const items: PageMenuOption[] = [];

  if (opts.canCreate) {
    items.push(
      {
        key: 'subpage',
        label: 'Add sub-page',
        icon: <AddOutlined size="xx-small" />,
        onSelect: opts.onAddSubpage,
      },
      {
        key: 'add-page',
        label: 'Add page',
        icon: <PageAPlusOutlined size="xx-small" />,
        onSelect: opts.onAddPage,
      },
      { key: 'create-divider', isDivider: true },
    );
  }

  items.push(
    {
      key: 'star',
      label: opts.isStarred ? 'Remove from starred' : 'Add to starred',
      icon: opts.isStarred ? <StarFilled size="xx-small" /> : <StarOutlined size="xx-small" />,
      onSelect: opts.onToggleStar,
    },
    {
      key: 'copy-link',
      label: 'Copy link',
      icon: <LinkOutlined size="xx-small" />,
      onSelect: opts.onCopyLink,
    },
    {
      key: 'open-new-tab',
      label: 'Open in new tab',
      icon: <ArrowOutOutlined size="xx-small" />,
      onSelect: opts.onOpenInNewTab,
    },
  );

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
