import { Button } from '@toddle-edu/ds-web';
import { AddOutlined, ShareOutlined } from '@toddle-edu/ds-icons';
import { IconButton } from '../../../components/IconButton';
import { ActionMenu } from '../../../components/ActionMenu';
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
        <ActionMenu
          placement="bottomRight"
          trigger={<IconButton icon="DotsHorizontalOutlined" iconSize={18} />}
          items={[
            ...(canCreate
              ? [
                  {
                    key: 'subpage',
                    label: 'Add sub-page',
                    icon: 'AddOutlined' as const,
                    onSelect: () => addSubPage(doc.id),
                  },
                ]
              : []),
            ...(canManage
              ? [
                  {
                    key: 'rename',
                    label: 'Rename',
                    icon: 'PencilOutlined' as const,
                    onSelect: () =>
                      openModal({
                        type: 'renamePage',
                        kind: 'doc',
                        workspaceId: ws,
                        id: doc.id,
                        name: doc.title,
                      }),
                  },
                  {
                    key: 'delete',
                    label: 'Delete',
                    icon: 'DeleteOutlined' as const,
                    danger: true,
                    dividerBefore: true,
                    onSelect: () =>
                      openModal({
                        type: 'confirmDeletePage',
                        kind: 'doc',
                        workspaceId: ws,
                        id: doc.id,
                        name: doc.title,
                      }),
                  },
                ]
              : []),
          ]}
        />
      )}
    </>
  );
}
