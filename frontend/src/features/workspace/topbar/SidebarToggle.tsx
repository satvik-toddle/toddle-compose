import { IconButton, Tooltip } from '@toddle-edu/ds-web';
import { ArrowLeftPaneOutlined, ArrowRightPaneOutlined } from '@toddle-edu/ds-icons';
import { commandModifierKey } from '../../../lib/platform';
import { ShortcutHint } from '../../../components/ShortcutHint';

const shortcutKeys = [commandModifierKey, '\\'];

const styles = {
  tooltip: 'flex items-center gap-2',
};

export function SidebarToggle({
  collapsed,
  onToggle,
}: Readonly<{ collapsed: boolean; onToggle: () => void }>) {
  const label = collapsed ? 'Show pages' : 'Hide pages';

  return (
    <Tooltip
      dsVersion="2.0"
      showArrow
      tooltip={
        <span className={styles.tooltip}>
          {label}
          <ShortcutHint keys={shortcutKeys} />
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
