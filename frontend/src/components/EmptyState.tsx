import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { EmptyState as DsEmptyState } from '@toddle-edu/ds-web';

// ds-web EmptyState requires an illustration image. We don't ship illustration
// assets, so render the caller's emoji glyph as an inline SVG data-URI. Non-string
// glyphs (icons) fall back to a neutral mark.
function emojiIllustration(glyph: ReactNode): string {
  const emoji = typeof glyph === 'string' ? glyph : '📄';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="22" fill="%23f5f5f5"/><text x="48" y="52" font-size="52" text-anchor="middle" dominant-baseline="central">${emoji}</text></svg>`;
  return `data:image/svg+xml;utf8,${svg}`;
}

export function EmptyState({
  glyph,
  title,
  children,
  actions,
  footer,
}: {
  glyph: ReactNode;
  glyphStyle?: CSSProperties;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <DsEmptyState
        illustration={emojiIllustration(glyph)}
        title={typeof title === 'string' ? title : String(title ?? '')}
        subtitle={typeof children === 'string' ? children : undefined}
        primaryButton={(actions as ReactElement) ?? undefined}
      />
      {footer}
    </div>
  );
}
