import { Badge, IconButton, Tooltip } from '@toddle-edu/ds-web';
import { ArrowLeftPaneOutlined, ArrowRightPaneOutlined } from '@toddle-edu/ds-icons';
import { isAppleDevice } from '../../../lib/platform';

const shortcutKeys = isAppleDevice ? ['⌘', '\\'] : ['Ctrl', '\\'];

const styles = {
  tooltip: 'flex items-center gap-2',
  keys: 'flex items-center gap-1',
};

export function SidebarToggle({
  collapsed,
  onToggle,
}: Readonly<{ collapsed: boolean; onToggle: () => void }>) {
  const label = collapsed ? 'Show pages' : 'Hide pages';

  return (
    <Tooltip
      dsVersion="2.0"
      tooltip={
        <span className={styles.tooltip}>
          {label}
          <span className={styles.keys}>
            {shortcutKeys.map((key) => (
              <Badge key={key} dsVersion="2.0" type="shortcut" value={key} shape="square" />
            ))}
          </span>
        </span>
      }
    >
      <IconButton
        dsVersion="2.0"
        variant="neutral"
        type="plain"
        icon={collapsed ? <ArrowRightPaneOutlined /> : <ArrowLeftPaneOutlined />}
        aria-label={label}
        onClick={onToggle}
      />
    </Tooltip>
  );
}
