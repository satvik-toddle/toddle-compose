import { Button, Dropdown, DropdownMenu, IconButton } from '@toddle-edu/ds-web';
import {
  AddOutlined,
  ClockRecentsOutlined,
  DeleteOutlined,
  DotsHorizontalOutlined,
  ShareOutlined,
} from '@toddle-edu/ds-icons';
import { useUiStore } from '../../../stores/uiStore';
import { wsAtLeast } from '../../../lib/roles';
import type { DocumentDto, User } from '../../../types/api';
import type { WorkspaceCtx } from '../context';
import { useHistoryMode } from '../history';
import { CreatePageDropdown } from '../CreatePageDropdown';
import {
  findPageMenuOption,
  pageTypeSubmenu,
  type PageMenuOption,
} from '../sidebar/PagesSection/pageMenuItems';
import { usePageActions } from './usePageActions';

const SUB_PAGE_KEY = 'subpage';
const DELETE_KEY = 'delete';

export function DocActions({
  ctx,
  doc,
  user,
}: Readonly<{ ctx: WorkspaceCtx; doc?: DocumentDto; user: User }>) {
  const openModal = useUiStore((state) => state.openModal);
  const history = useHistoryMode();
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
    // Divider only when a create group sits above it, else it leads the menu.
    ...(canCreate && canManage ? [{ key: `${DELETE_KEY}__divider`, isDivider: true }] : []),
    ...(canManage
      ? [
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

  // Version history is only meaningful for DOC pages (SHEET has no lexical
  // projection to render read-only yet).
  const showHistory = doc.type === 'DOC';

  return (
    <>
      {showHistory && (
        <IconButton
          dsVersion="2.0"
          variant={history.active ? 'primary' : 'neutral'}
          type={history.active ? 'fill' : 'plain'}
          icon={<ClockRecentsOutlined />}
          aria-label={history.active ? 'Exit version history' : 'Version history'}
          onClick={() => (history.active ? history.exit() : history.enter())}
        />
      )}
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
