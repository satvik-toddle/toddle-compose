import { Dropdown, DropdownMenu } from '@toddle-edu/ds-web';
import { ChevronDownOutlined, ChevronLeftOutlined, OutlinedIcons } from '@toddle-edu/ds-icons';
import { useRealm, useWorkspaces } from '../../../hooks/queries';
import { useEnterWorkspace, useLeaveWorkspace } from '../../../hooks/useAuthMutations';
import { isRealmAdmin } from '../../../lib/roles';
import { workspaceVisual } from '../../../lib/workspaceVisual';
import type { WorkspaceCtx } from '../context';
import s from '../WorkspaceLayout.module.scss';

const LEAVE_KEY = '__leave';

// The workspace glyph is a dynamic ds-icon name; resolve it from the ds-icons
// namespace. Brand color is applied via overrideVariantStyles + style.
const resolveDsIcon = (name: string) => OutlinedIcons[name as keyof typeof OutlinedIcons];

export function WorkspaceSwitcher({ ctx }: Readonly<{ ctx: WorkspaceCtx }>) {
  const { data: realm } = useRealm();
  const { data: workspaces = [] } = useWorkspaces();
  const enterWorkspace = useEnterWorkspace();
  const leaveWorkspace = useLeaveWorkspace();
  const currentWorkspaceVisual = workspaceVisual(ctx.workspaceId);
  const CurrentWorkspaceIcon = resolveDsIcon(currentWorkspaceVisual.icon);

  // A "Switch workspace" group (tick on the current one) + a "back to launcher" footer.
  const menuOptions = [
    {
      key: '__hdr',
      label: 'Switch workspace',
      isItemGroup: true,
      options: workspaces.map((workspace) => {
        const visual = workspaceVisual(workspace.id);
        const WorkspaceIcon = resolveDsIcon(visual.icon);
        return {
          key: workspace.id,
          label: workspace.name,
          icon: (
            <WorkspaceIcon size="xxx-small" overrideVariantStyles style={{ color: visual.color }} />
          ),
        };
      }),
    },
    {
      key: LEAVE_KEY,
      label: isRealmAdmin(realm?.role) ? 'Back to all workspaces' : 'Workspace launcher',
      icon: <ChevronLeftOutlined size="xxx-small" variant="subtle" />,
    },
  ];

  const handleSelect = (key: string) => {
    if (key === LEAVE_KEY) leaveWorkspace.mutate();
    else if (key !== ctx.workspaceId) enterWorkspace.mutate(key);
  };

  return (
    <Dropdown
      trigger={['click']}
      placement="bottomLeft"
      overlay={
        <DropdownMenu
          dsVersion="2.0"
          options={menuOptions}
          value={ctx.workspaceId}
          showSelection
          selectionType="tick"
          onClick={(option: { key: string }) => handleSelect(option.key)}
        />
      }
    >
      {/* antd attaches its ref/onClick to a DOM node — wrap the trigger so it doesn't warn about refs. */}
      <span className="ds-dd-trigger" style={{ display: 'inline-flex' }}>
        <button className={s.wsSwitch}>
          <span
            className="ws-emoji sm"
            style={{
              background: currentWorkspaceVisual.color + '22',
              boxShadow: `inset 0 0 0 1px ${currentWorkspaceVisual.color}44`,
            }}
          >
            <CurrentWorkspaceIcon
              size="x-small"
              overrideVariantStyles
              style={{ color: currentWorkspaceVisual.color }}
            />
          </span>
          <span className="nm">{ctx.name}</span>
          <ChevronDownOutlined size="xxx-small" variant="subtle" />
        </button>
      </span>
    </Dropdown>
  );
}
