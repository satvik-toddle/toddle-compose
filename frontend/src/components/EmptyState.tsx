import type { ReactElement, ReactNode } from 'react';
import { EmptyState as DsEmptyState } from '@toddle-edu/ds-web';

// Text-only ds-web EmptyState: illustration is required by the ds types but its
// renderer skips falsy values, so an empty string yields no image.
export function EmptyState({
  title,
  children,
  actions,
  footer,
}: {
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <DsEmptyState
        illustration=""
        title={typeof title === 'string' ? title : String(title ?? '')}
        titleStyle={{ fontSize: '18px', lineHeight: '24px', fontWeight: 700 }}
        subtitle={typeof children === 'string' ? children : undefined}
        primaryButton={(actions as ReactElement) ?? undefined}
      />
      {footer}
    </div>
  );
}
