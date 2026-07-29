import { Button, Dropdown, DropdownMenu, IconButton, ToggleSwitch } from '@toddle-edu/ds-web';
import {
  AddOutlined,
  ClockRecentsOutlined,
  CornersInOutlined,
  CornersOutOutlined,
  DeleteOutlined,
  DotsHorizontalOutlined,
  LockOutlined,
  PageFoldLandscapeOutlined,
} from '@toddle-edu/ds-icons';
import { useUiStore } from '../../../stores/uiStore';
import { maxWsRole, wsAtLeast } from '../../../lib/roles';
import { useSetDocFullWidth } from '../../../hooks/usePages';
import type { DocumentDto, User } from '../../../types/api';
import type { WorkspaceCtx } from '../context';
import { useHistoryMode } from '../history';
import { useFullScreenMode } from '../useFullScreenMode';
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
const FULL_WIDTH_KEY = 'fullWidth';
const FULL_SCREEN_KEY = 'fullScreen';

export function DocActions({
  ctx,
  doc,
  user,
}: Readonly<{ ctx: WorkspaceCtx; doc?: DocumentDto; user: User }>) {
  const openModal = useUiStore((state) => state.openModal);
  const history = useHistoryMode();
  const fullScreen = useFullScreenMode();
  const setFullWidth = useSetDocFullWidth();
  const { newPage, addSubPage, isPending } = usePageActions(ctx.workspaceId);
  const { workspaceId, isAdmin, role } = ctx;
  const canCreate = wsAtLeast(role, 'EDIT');
  const canManage = !!doc && (isAdmin || doc.owner.id === user.id || doc.myRole === 'ADMIN');
  // Effective write right (ws role OR per-doc grant) — mirrors PageView; gates the persisted
  // full-width toggle. Full screen is a pure view and stays ungated.
  const canEditDoc = !!doc && wsAtLeast(maxWsRole(role, doc.myRole ?? null), 'EDIT');

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
  // Full width is a DOC-only layout choice (sheets/whiteboards are always full-width);
  // it persists, so it needs write rights.
  const showFullWidth = doc.type === 'DOC' && canEditDoc;
  const toggleFullWidth = () =>
    setFullWidth.mutate({ workspaceId, id: doc.id, fullWidth: !doc.fullWidth });

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
    // Page layout: persisted full-width toggle (DOC, editors) + ephemeral full-screen (all, any viewer).
    ...(showFullWidth
      ? [
          {
            key: FULL_WIDTH_KEY,
            label: 'Full width',
            icon: <PageFoldLandscapeOutlined size="xxx-small" variant="subtle" />,
            // shouldStopPropagation keeps the click off the menu item, so toggling here doesn't
            // dismiss the menu (the DS menu closes itself on any item click). onChange drives the
            // switch; a click on the row label still toggles via onSelect (and closes, as usual).
            suffix: (
              <ToggleSwitch
                dsVersion="2.0"
                size="medium"
                checked={doc.fullWidth}
                onChange={toggleFullWidth}
                shouldStopPropagation
                aria-label="Full width"
              />
            ),
            onSelect: toggleFullWidth,
          },
        ]
      : []),
    {
      key: FULL_SCREEN_KEY,
      label: fullScreen.active ? 'Exit full screen' : 'Full screen',
      icon: fullScreen.active ? (
        <CornersInOutlined size="xxx-small" variant="subtle" />
      ) : (
        <CornersOutOutlined size="xxx-small" variant="subtle" />
      ),
      onSelect: () => (fullScreen.active ? fullScreen.exit() : fullScreen.enter()),
    },
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
    // Always renders: even a pure viewer gets the Full screen action.
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
  );
}
