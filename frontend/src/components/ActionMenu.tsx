import type { ComponentType, CSSProperties, ReactElement } from 'react';
import { Dropdown, DropdownMenu } from '@toddle-edu/ds-web';
import { Icon, type IconName } from './Icon';

// ds-web Dropdown is antd-based with version-switching unions; use untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DsDropdown = Dropdown as unknown as ComponentType<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DsMenu = DropdownMenu as unknown as ComponentType<any>;

export interface MenuItem {
  key: string;
  label: string;
  icon?: IconName;
  iconColor?: string;
  danger?: boolean;
  dividerBefore?: boolean;
  onSelect: () => void;
}

// A ds-web dropdown menu: a trigger element + a list of actions. Replaces the
// app's bespoke `.folder-menu` / `.ws-switch-menu` dropdowns (ds styling, managed
// open state + positioning + a11y come from ds-web/antd).
export function ActionMenu({
  trigger,
  items,
  header,
  selectedKey,
  placement = 'bottomLeft',
}: {
  trigger: ReactElement;
  items: MenuItem[];
  header?: string;
  selectedKey?: string; // shows a tick on the matching item
  placement?: string;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options: Record<string, any>[] = [];
  if (header) options.push({ key: '__hdr', label: header, isItemGroup: true });
  for (const it of items) {
    if (it.dividerBefore) options.push({ key: `${it.key}__div`, isDivider: true });
    const style: CSSProperties | undefined = it.iconColor ? { color: it.iconColor } : undefined;
    options.push({
      key: it.key,
      label: it.label,
      isDestructive: it.danger,
      icon: it.icon ? (
        <Icon name={it.icon} size={14} muted={!it.danger && !it.iconColor} red={it.danger} style={style} />
      ) : undefined,
    });
  }
  const onSelectByKey = new Map(items.map((i) => [i.key, i.onSelect]));

  return (
    <DsDropdown
      trigger={['click']}
      placement={placement}
      overlay={
        <DsMenu
          options={options}
          value={selectedKey}
          showSelection={!!selectedKey}
          selectionType="tick"
          onClick={({ key }: { key: string }) => onSelectByKey.get(key)?.()}
        />
      }
    >
      {/* antd attaches its ref/onClick to a DOM node — wrap the (function-
          component) trigger in a span so it doesn't warn about refs. */}
      <span className="ds-dd-trigger" style={{ display: 'inline-flex' }}>{trigger}</span>
    </DsDropdown>
  );
}
