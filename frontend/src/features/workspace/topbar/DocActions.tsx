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
import { usePageActions } from './usePageActions';

export function DocActions({
  ctx,
  doc,
  me,
}: Readonly<{ ctx: WorkspaceCtx; doc?: DocumentDto; me: User }>) {
  const openModal = useUiStore((s) => s.openModal);
  const { newPage, addSubPage, isPending } = usePageActions(ctx.workspaceId);
  const ws = ctx.workspaceId;
  const canCreate = wsAtLeast(ctx.role, 'EDIT');
  const canManage = !!doc && (ctx.isAdmin || doc.owner.id === me.id);

  if (!doc) {
    return (
      canCreate && (
        <Button
          dsVersion="2.0"
          variant="primary"
          type="fill"
          icon={<AddOutlined />}
          onClick={newPage}
          disabled={isPending}
        >
          New page
        </Button>
      )
    );
  }

  const menuOptions = [
    ...(canCreate
      ? [
          {
            key: 'subpage',
            label: 'Add sub-page',
            icon: <AddOutlined size="xxx-small" variant="subtle" />,
          },
        ]
      : []),
    ...(canManage
      ? [
          {
            key: 'rename',
            label: 'Rename',
            icon: <PencilOutlined size="xxx-small" variant="subtle" />,
          },
          { key: 'delete__div', isDivider: true },
          {
            key: 'delete',
            label: 'Delete',
            icon: <DeleteOutlined size="xxx-small" variant="critical" />,
            isDestructive: true,
          },
        ]
      : []),
  ];

  const handleMenuSelect = (key: string) => {
    if (key === 'subpage') addSubPage(doc.id);
    else if (key === 'rename') {
      openModal({ type: 'renamePage', kind: 'doc', workspaceId: ws, id: doc.id, name: doc.title });
    } else if (key === 'delete') {
      openModal({
        type: 'confirmDeletePage',
        kind: 'doc',
        workspaceId: ws,
        id: doc.id,
        name: doc.title,
      });
    }
  };

  return (
    <>
      <Button
        dsVersion="2.0"
        variant="neutral"
        type="outlined"
        icon={<ShareOutlined />}
        onClick={() =>
          openModal({
            type: 'shareDocument',
            workspaceId: ws,
            docId: doc.id,
            docTitle: doc.title,
            canManage,
            isAdmin: ctx.isAdmin,
          })
        }
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
              onClick={(option: { key: string }) => handleMenuSelect(option.key)}
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
