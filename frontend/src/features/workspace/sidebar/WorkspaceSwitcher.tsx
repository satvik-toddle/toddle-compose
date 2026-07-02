import { Button, Dropdown, DropdownMenu } from '@toddle-edu/ds-web';
import { ChevronLeftOutlined, ChevronDownOutlined, OutlinedIcons } from '@toddle-edu/ds-icons';
import { useRealm, useWorkspaces } from '../../../hooks/queries';
import { useEnterWorkspace, useLeaveWorkspace } from '../../../hooks/useAuthMutations';
import { isRealmAdmin } from '../../../lib/roles';
import { workspaceVisual } from '../../../lib/workspaceVisual';
import type { WorkspaceCtx } from '../context';

const HEADER_KEY = '__hdr';
const LEAVE_KEY = '__leave';

const resolveDsIcon = (name: string) => OutlinedIcons[name as keyof typeof OutlinedIcons];

export function WorkspaceSwitcher({ ctx }: Readonly<{ ctx: WorkspaceCtx }>) {
  const { data: realm } = useRealm();
  const { data: workspaces = [] } = useWorkspaces();
  const enterWorkspace = useEnterWorkspace();
  const leaveWorkspace = useLeaveWorkspace();
  const currentWorkspaceVisual = workspaceVisual(ctx.workspaceId);
  const CurrentWorkspaceIcon = resolveDsIcon(currentWorkspaceVisual.icon);

  const menuOptions = [
    {
      key: HEADER_KEY,
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
    if (key === LEAVE_KEY) {
      leaveWorkspace.mutate();
      return;
    }
    const isCurrentWorkspace = key === ctx.workspaceId;
    if (isCurrentWorkspace) return;
    enterWorkspace.mutate(key);
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
      {/* Wrapped in a span so antd's open-on-click handler lands on a DOM node.
          Plain ds Button (regular/h-9) with the workspace icon + a chevron rightIcon. */}
      <span className="flex w-full">
        <Button
          dsVersion="2.0"
          variant="neutral"
          type="plain"
          isFullWidth
          style={{ maxWidth: '100%' }}
          icon={
            <CurrentWorkspaceIcon
              overrideVariantStyles
              style={{ color: currentWorkspaceVisual.color }}
            />
          }
          rightIcon={<ChevronDownOutlined variant="subtle" />}
        >
          {ctx.name}
        </Button>
      </span>
    </Dropdown>
  );
}
