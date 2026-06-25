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
const dsIcon = (name: string) => OutlinedIcons[name as keyof typeof OutlinedIcons];

export function WorkspaceSwitcher({ ctx }: Readonly<{ ctx: WorkspaceCtx }>) {
  const { data: realm } = useRealm();
  const { data: workspaces = [] } = useWorkspaces();
  const enter = useEnterWorkspace();
  const leave = useLeaveWorkspace();
  const vis = workspaceVisual(ctx.workspaceId);
  const VisIcon = dsIcon(vis.icon);

  // A "Switch workspace" group (tick on the current one) + a "back to launcher" footer.
  const options = [
    {
      key: '__hdr',
      label: 'Switch workspace',
      isItemGroup: true,
      options: workspaces.map((w) => {
        const wv = workspaceVisual(w.id);
        const WsIcon = dsIcon(wv.icon);
        return {
          key: w.id,
          label: w.name,
          icon: <WsIcon size="xxx-small" overrideVariantStyles style={{ color: wv.color }} />,
        };
      }),
    },
    {
      key: LEAVE_KEY,
      label: isRealmAdmin(realm?.role) ? 'Back to all workspaces' : 'Workspace launcher',
      icon: <ChevronLeftOutlined size="xxx-small" variant="subtle" />,
    },
  ];

  const onSelect = (key: string) => {
    if (key === LEAVE_KEY) leave.mutate();
    else if (key !== ctx.workspaceId) enter.mutate(key);
  };

  return (
    <Dropdown
      trigger={['click']}
      placement="bottomLeft"
      overlay={
        <DropdownMenu
          dsVersion="2.0"
          options={options}
          value={ctx.workspaceId}
          showSelection
          selectionType="tick"
          onClick={(item: { key: string }) => onSelect(item.key)}
        />
      }
    >
      {/* antd attaches its ref/onClick to a DOM node — wrap the trigger so it doesn't warn about refs. */}
      <span className="ds-dd-trigger" style={{ display: 'inline-flex' }}>
        <button className={s.wsSwitch}>
          <span
            className="ws-emoji sm"
            style={{ background: vis.color + '22', boxShadow: `inset 0 0 0 1px ${vis.color}44` }}
          >
            <VisIcon size="x-small" overrideVariantStyles style={{ color: vis.color }} />
          </span>
          <span className="nm">{ctx.name}</span>
          <ChevronDownOutlined size="xxx-small" variant="subtle" />
        </button>
      </span>
    </Dropdown>
  );
}
