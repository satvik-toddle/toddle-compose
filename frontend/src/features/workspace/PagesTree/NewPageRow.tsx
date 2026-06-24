import { Icon } from '../../../components/Icon';
import s from './PagesTree.module.scss';

// Coda-style "+ New page" row shown at the bottom of the tree and beneath each
// expanded parent. `indent` (px) aligns the + with the page-icon column at depth.
export function NewPageRow({ indent, onClick }: Readonly<{ indent: number; onClick: () => void }>) {
  return (
    <div className={s.newPageRow} style={{ paddingLeft: indent }} role="button" onClick={onClick}>
      <Icon name="AddOutlined" size={16} muted />
      New page
    </div>
  );
}
