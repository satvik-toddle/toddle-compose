import { Button, Dropdown, DropdownMenu, IconButton } from '@toddle-edu/ds-web';
import {
  AddOutlined,
  DeleteOutlined,
  DotsHorizontalOutlined,
  PencilOutlined,
  ShareOutlined,
} from '@toddle-edu/ds-icons';
import { useUiStore } from '../../../stores/uiStore';
import { wsAtLeast } from '../../../lib/roles';
import type { DocumentDto, User } from '../../../types/api';
import type { WorkspaceCtx } from '../context';
import { CreatePageDropdown } from '../CreatePageDropdown';
import {
  findPageMenuOption,
  pageTypeSubmenu,
  type PageMenuOption,
} from '../sidebar/PagesSection/pageMenuItems';
import { usePageActions } from './usePageActions';

const SUB_PAGE_KEY = 'subpage';
const RENAME_KEY = 'rename';
const DELETE_KEY = 'delete';

export function DocActions({
  ctx,
  doc,
  user,
}: Readonly<{ ctx: WorkspaceCtx; doc?: DocumentDto; user: User }>) {
  const openModal = useUiStore((state) => state.openModal);
  const { newPage, addSubPage, isPending } = usePageActions(ctx.workspaceId);
  const { workspaceId, isAdmin, role } = ctx;
  const canCreate = wsAtLeast(role, 'EDIT');
  const canManage = !!doc && (isAdmin || doc.owner.id === user.id);

  if (!doc) {
    return (
      canCreate && (
        <CreatePageDropdown placement="bottomRight" onCreate={newPage} disabled={isPending}>
          <span className="inline-flex">
            <Button
              dsVersion="2.0"
              variant="primary"
              type="fill"
              icon={<AddOutlined />}
              disabled={isPending}
            >
              New page
            </Button>
          </span>
        </CreatePageDropdown>
      )
    );
  }

  const openShareModal = () =>
    openModal({
      type: 'shareDocument',
      workspaceId,
      docId: doc.id,
      docTitle: doc.title,
      canManage,
      isAdmin,
    });
  const openRenameModal = () =>
    openModal({ type: 'renamePage', workspaceId, id: doc.id, name: doc.title });
  const openDeleteModal = () =>
    openModal({ type: 'confirmDeletePage', kind: 'doc', workspaceId, id: doc.id, name: doc.title });

  // Same option shape + click dispatch as the sidebar's page menu: each leaf carries its
  // own onSelect, and the create action reuses the shared Doc/Sheet submenu builder.
  const menuOptions: PageMenuOption[] = [
    ...(canCreate
      ? [
          {
            key: SUB_PAGE_KEY,
            label: 'Add sub-page',
            icon: <AddOutlined size="xxx-small" variant="subtle" />,
            isSubMenu: true,
            options: pageTypeSubmenu(SUB_PAGE_KEY, (type) => addSubPage(doc.id, type)),
          },
        ]
      : []),
    ...(canManage
      ? [
          {
            key: RENAME_KEY,
            label: 'Rename',
            icon: <PencilOutlined size="xxx-small" variant="subtle" />,
            onSelect: openRenameModal,
          },
          { key: `${DELETE_KEY}__divider`, isDivider: true },
          {
            key: DELETE_KEY,
            label: 'Delete',
            icon: <DeleteOutlined size="xxx-small" variant="critical" />,
            isDestructive: true,
            onSelect: openDeleteModal,
          },
        ]
      : []),
  ];

  return (
    <>
      <Button
        dsVersion="2.0"
        variant="neutral"
        type="outlined"
        icon={<ShareOutlined />}
        onClick={openShareModal}
      >
        Share
      </Button>
      {(canCreate || canManage) && (
        <Dropdown
          trigger={['click']}
          placement="bottomRight"
          overlay={
            <DropdownMenu
              dsVersion="2.0"
              options={menuOptions}
              onClick={(option: { key: string }) =>
                findPageMenuOption(menuOptions, option.key)?.onSelect?.()
              }
            />
          }
        >
          {/* antd attaches its open-on-click handler to this DOM node. */}
          <span className="inline-flex">
            <IconButton
              dsVersion="2.0"
              variant="neutral"
              type="plain"
              icon={<DotsHorizontalOutlined />}
              aria-label="Page actions"
            />
          </span>
        </Dropdown>
      )}
    </>
  );
}
