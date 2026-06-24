import { AddOutlined } from '@toddle-edu/ds-icons';
import { cn } from '../../../../lib/cn';
import { sidebarRow } from '../sidebarRowStyles';

// `indent` (px) aligns the + with the page-icon column at the row's depth.
export function NewPageRow({ indent, onClick }: Readonly<{ indent: number; onClick: () => void }>) {
  return (
    <button
      type="button"
      className={cn(sidebarRow.base, sidebarRow.default)}
      style={{ paddingLeft: indent }}
      onClick={onClick}
    >
      <AddOutlined size="xxx-small" />
      New page
    </button>
  );
}
