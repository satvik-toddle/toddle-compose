import { PageFoldPortraitOutlined } from '@toddle-edu/ds-icons';

const styles = {
  crumb: 'flex items-center gap-1 min-w-0',
  separator: 'text-secondary mr-1',
  title: 'truncate text-heading-6 text-primary',
};

export function DocBreadcrumb({ title }: Readonly<{ title: string }>) {
  return (
    <div className={styles.crumb}>
      <span className={styles.separator}>/</span>
      <PageFoldPortraitOutlined size="xx-small" variant="subtle" />
      <span className={styles.title}>{title}</span>
    </div>
  );
}
