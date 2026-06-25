import { Icon } from '../../../components/Icon';
import s from '../WorkspaceLayout.module.scss';

export function DocBreadcrumb({ title }: Readonly<{ title: string }>) {
  return (
    <div className={s.wsCrumb}>
      <span className={s.wsCrumbSep}>/</span>
      <Icon name="FileOutlined" size={16} muted />
      <span className={s.wsCrumbTitle}>{title}</span>
    </div>
  );
}
