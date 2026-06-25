import { IconButton } from '@toddle-edu/ds-web';
import { ArrowLeftPaneOutlined } from '@toddle-edu/ds-icons';

export function SidebarToggle({ onToggle }: Readonly<{ onToggle: () => void }>) {
  return (
    <IconButton
      dsVersion="2.0"
      variant="neutral"
      type="plain"
      size="small"
      icon={<ArrowLeftPaneOutlined />}
      aria-label="Toggle sidebar"
      onClick={onToggle}
    />
  );
}
