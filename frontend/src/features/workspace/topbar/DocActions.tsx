import { Button, Dropdown, DropdownMenu, IconButton } from '@toddle-edu/ds-web';
import {
  AddOutlined,
  ClockRecentsOutlined,
  DeleteOutlined,
  DotsHorizontalOutlined,
  ExportOutlined,
  LinkOutlined,
  LockOutlined,
} from '@toddle-edu/ds-icons';
import { useUiStore } from '../../../stores/uiStore';
import { useDocCodaMappings } from '../../../hooks/useMigrations';
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
const PERMISSIONS_KEY = 'permissions';
const DELETE_KEY = 'delete';
const HISTORY_KEY = 'history';
const COPY_TO_CODA_KEY = 'copy-to-coda';
const OPEN_IN_CODA_KEY = 'open-in-coda';

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
  const canManage = !!doc && (isAdmin || doc.owner.id === user.id || doc.myRole === 'ADMIN');
  // Copy to Coda is a workspace editor+ action (grant-only guests are excluded).
  const canMigrate = wsAtLeast(role, 'EDIT') || isAdmin;
  // "Open in Coda" shows only when this doc already has a saved Coda destination.
  const { data: codaMappings } = useDocCodaMappings(doc?.id, canMigrate && !!doc);

  if (!doc) {
    return (
      canCreate && (
        <CreatePageDropdown placement="bottomRight" onCreate={newPage} disabled={isPending}>
          <Button
            dsVersion="2.0"
            variant="primary"
            type="fill"
            icon={<AddOutlined />}
            disabled={isPending}
          >
            New page
          </Button>
        </CreatePageDropdown>
      )
    );
  }

  const openPermissionsModal = () =>
    openModal({
      type: 'docPermissions',
      docId: doc.id,
      docTitle: doc.title,
      // DocumentDto.owner carries no email; supply the viewer's when they are the owner.
      owner: {
        id: doc.owner.id,
        name: doc.owner.name,
        color: doc.owner.color,
        email: doc.owner.id === user.id ? user.email : undefined,
      },
    });
  const openDeleteModal = () =>
    openModal({ type: 'confirmDeletePage', kind: 'doc', workspaceId, id: doc.id, name: doc.title });

  // Version history is only meaningful for DOC pages (SHEET has no lexical
  // projection to render read-only yet).
  const showHistory = doc.type === 'DOC';

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
            key: PERMISSIONS_KEY,
            label: 'Share',
            icon: <LockOutlined size="xxx-small" variant="subtle" />,
            onSelect: openPermissionsModal,
          },
        ]
      : []),
    // Version history sits right below Share; available to every reader (not gated by edit rights).
    ...(showHistory
      ? [
          {
            key: HISTORY_KEY,
            label: history.active ? 'Exit version history' : 'Version history',
            icon: <ClockRecentsOutlined size="xxx-small" variant="subtle" />,
            onSelect: () => (history.active ? history.exit() : history.enter()),
          },
        ]
      : []),
    ...(canMigrate
      ? [
          {
            key: COPY_TO_CODA_KEY,
            label: 'Copy to Coda',
            icon: <ExportOutlined size="xxx-small" variant="subtle" />,
            onSelect: () => openModal({ type: 'copyToCoda', docId: doc.id, workspaceId }),
          },
        ]
      : []),
    // Directly below Copy to Coda; only when this doc has ≥1 saved Coda destination.
    // Exactly one → open its URL; several → a submenu of destinations (label → URL).
    ...(canMigrate && codaMappings && codaMappings.length > 0
      ? [
          codaMappings.length === 1
            ? {
                key: OPEN_IN_CODA_KEY,
                label: 'Open in Coda',
                icon: <LinkOutlined size="xxx-small" variant="subtle" />,
                onSelect: () => window.open(codaMappings[0].codaPageUrl, '_blank', 'noopener'),
              }
            : {
                key: OPEN_IN_CODA_KEY,
                label: 'Open in Coda',
                icon: <LinkOutlined size="xxx-small" variant="subtle" />,
                isSubMenu: true,
                options: codaMappings.map((m) => ({
                  key: `${OPEN_IN_CODA_KEY}:${m.scopeId}`,
                  label: m.scopeLabel,
                  onSelect: () => window.open(m.codaPageUrl, '_blank', 'noopener'),
                })),
              },
        ]
      : []),
    // Divider before Delete; Share (also canManage) always sits above it when Delete renders.
    ...(canManage ? [{ key: `${DELETE_KEY}__divider`, isDivider: true }] : []),
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

  return (
    <>
      {(canCreate || canManage || showHistory) && (
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
          <IconButton
            dsVersion="2.0"
            variant="neutral"
            type="plain"
            icon={<DotsHorizontalOutlined />}
            aria-label="Page actions"
          />
        </Dropdown>
      )}
    </>
  );
}
