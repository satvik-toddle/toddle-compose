import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Dropdown, DropdownMenu, IconButton } from '@toddle-edu/ds-web';
import { DotsHorizontalOutlined } from '@toddle-edu/ds-icons';
import type { BreadcrumbSegment } from './ancestorTrail';

const styles = {
  // -ml-1 cancels the topbar's gap-1 so the lead matches the inter-segment spacing.
  crumb:
    'relative -ml-1 flex items-center min-w-0 overflow-hidden whitespace-nowrap text-heading-6',
  measure: 'invisible pointer-events-none absolute left-0 flex items-center',
  separator: 'shrink-0 mx-2 text-secondary',
  link: 'shrink-0 text-secondary hover:text-primary hover:underline',
  current: 'min-w-0 truncate text-primary',
};

// Below this many segments there's nothing in the middle to fold away.
const MIN_SEGMENTS_TO_COLLAPSE = 4;

export function DocBreadcrumb({
  trail,
  workspaceId,
}: Readonly<{ trail: BreadcrumbSegment[]; workspaceId: string }>) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const hrefFor = (id: string) => `/w/${workspaceId}?doc=${id}`;
  const canCollapse = trail.length >= MIN_SEGMENTS_TO_COLLAPSE;

  // Show the whole trail while it fits; fold the middle into an ellipsis once
  // the full version would overflow the topbar.
  useLayoutEffect(() => {
    if (!canCollapse) {
      setIsCollapsed(false);
      return;
    }
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const update = () => setIsCollapsed(measure.scrollWidth > container.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [trail, canCollapse]);

  const lastIndex = trail.length - 1;
  const hiddenAncestors = isCollapsed ? trail.slice(1, lastIndex - 1) : [];

  const renderSegment = (segment: BreadcrumbSegment, index: number) =>
    index === lastIndex ? (
      <span className={styles.current}>{segment.title}</span>
    ) : (
      <Link to={hrefFor(segment.id)} className={styles.link}>
        {segment.title}
      </Link>
    );

  const visibleSegments = isCollapsed
    ? [
        { key: trail[0].id, node: renderSegment(trail[0], 0) },
        {
          key: 'ellipsis',
          node: (
            <HiddenAncestorsMenu
              ancestors={hiddenAncestors}
              onSelect={(id) => navigate(hrefFor(id))}
            />
          ),
        },
        { key: trail[lastIndex - 1].id, node: renderSegment(trail[lastIndex - 1], lastIndex - 1) },
        { key: trail[lastIndex].id, node: renderSegment(trail[lastIndex], lastIndex) },
      ]
    : trail.map((segment, index) => ({ key: segment.id, node: renderSegment(segment, index) }));

  return (
    <div ref={containerRef} className={styles.crumb}>
      <div ref={measureRef} aria-hidden className={styles.measure}>
        {trail.map((segment, index) => (
          <Fragment key={segment.id}>
            <span className={styles.separator}>{index === 0 ? '|' : '/'}</span>
            <span className="shrink-0">{segment.title}</span>
          </Fragment>
        ))}
      </div>

      {visibleSegments.map(({ key, node }, index) => (
        <Fragment key={key}>
          <span className={styles.separator}>{index === 0 ? '|' : '/'}</span>
          {node}
        </Fragment>
      ))}
    </div>
  );
}

function HiddenAncestorsMenu({
  ancestors,
  onSelect,
}: Readonly<{ ancestors: BreadcrumbSegment[]; onSelect: (id: string) => void }>) {
  return (
    <Dropdown
      overlay={
        <DropdownMenu
          dsVersion="2.0"
          options={ancestors.map((ancestor) => ({ key: ancestor.id, label: ancestor.title }))}
          onClick={(option) => onSelect(option.key)}
        />
      }
    >
      <IconButton
        dsVersion="2.0"
        variant="neutral"
        type="plain"
        size="x-small"
        icon={<DotsHorizontalOutlined />}
        aria-label="Show hidden pages"
      />
    </Dropdown>
  );
}
