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
import type { DocumentDto, DocumentType, User } from '../../../types/api';
import type { WorkspaceCtx } from '../context';
import { CreatePageDropdown } from '../CreatePageDropdown';
import { PAGE_TYPES } from '../pageTypes';
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
    openModal({ type: 'renamePage', kind: 'doc', workspaceId, id: doc.id, name: doc.title });
  const openDeleteModal = () =>
    openModal({ type: 'confirmDeletePage', kind: 'doc', workspaceId, id: doc.id, name: doc.title });

  const runMenuAction: Record<string, () => void> = {
    [RENAME_KEY]: openRenameModal,
    [DELETE_KEY]: openDeleteModal,
  };

  // Sub-page leaves carry a `subpage:<type>` key; everything else routes by key.
  const onMenuClick = (key: string) => {
    if (key.startsWith(`${SUB_PAGE_KEY}:`)) {
      addSubPage(doc.id, key.slice(SUB_PAGE_KEY.length + 1) as DocumentType);
      return;
    }
    runMenuAction[key]?.();
  };

  const menuOptions = [
    ...(canCreate
      ? [
          {
            key: SUB_PAGE_KEY,
            label: 'Add sub-page',
            icon: <AddOutlined size="xxx-small" variant="subtle" />,
            isSubMenu: true,
            options: PAGE_TYPES.map((p) => ({
              key: `${SUB_PAGE_KEY}:${p.type}`,
              label: p.label,
              subText: p.description,
              icon: <p.Icon size="small" variant="subtle" />,
            })),
          },
        ]
      : []),
    ...(canManage
      ? [
          {
            key: RENAME_KEY,
            label: 'Rename',
            icon: <PencilOutlined size="xxx-small" variant="subtle" />,
          },
          { key: `${DELETE_KEY}__divider`, isDivider: true },
          {
            key: DELETE_KEY,
            label: 'Delete',
            icon: <DeleteOutlined size="xxx-small" variant="critical" />,
            isDestructive: true,
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
              onClick={(option: { key: string }) => onMenuClick(option.key)}
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
