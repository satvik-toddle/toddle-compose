import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DotsSixVerticalOutlined } from '@toddle-edu/ds-icons';
import { pageTypeIcon } from '../workspace/pageTypes';
import { cn } from '../../lib/cn';
import { applyDrag, getProjection, removeChildrenOf, type MigrationFlatItem } from './migrationTreeModel';

const INDENT = 24;
// Base left inset so even depth-0 rows aren't flush to the container edge.
const BASE_PAD = 12;

const styles = {
  row: 'relative flex min-h-8 items-center gap-2 rounded-2 border border-transparent px-1.5 py-1.5 hover:bg-surface-primary-hover',
  rowActive: 'bg-surface-secondary-hover',
  rowParent: 'bg-surface-primary-hover',
  handle:
    'flex shrink-0 cursor-grab items-center text-secondary active:cursor-grabbing touch-none',
  title: 'min-w-0 flex-1 truncate text-body text-primary',
  end: 'flex shrink-0 items-center gap-2',
};

// A reusable nested drag-to-reparent tree. Encapsulates the canonical dnd-kit
// sortable-tree flow: flatten → SortableContext → horizontal-drag projection →
// rebuild. Per-row trailing controls are supplied by the caller via `renderRowEnd`.
export function MigrationTree({
  items,
  onItemsChange,
  renderRowEnd,
}: {
  items: MigrationFlatItem[];
  onItemsChange: (items: MigrationFlatItem[]) => void;
  renderRowEnd?: (id: string) => ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetLeft, setOffsetLeft] = useState(0);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Hide the dragged node's own subtree so it can't be dropped inside itself.
  const visible = useMemo(
    () => (activeId ? removeChildrenOf(items, [activeId]) : items),
    [items, activeId],
  );
  const sortedIds = useMemo(() => visible.map((i) => i.id), [visible]);

  const projected =
    activeId && overId ? getProjection(visible, activeId, overId, offsetLeft, INDENT) : null;

  const reset = () => {
    setActiveId(null);
    setOverId(null);
    setOffsetLeft(0);
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    setOverId(String(active.id));
  };
  const onDragMove = ({ delta }: DragMoveEvent) => setOffsetLeft(delta.x);
  const onDragOver = ({ over }: DragOverEvent) => setOverId(over ? String(over.id) : null);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (projected && over) {
      onItemsChange(applyDrag(items, String(active.id), String(over.id), projected));
    }
    reset();
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={reset}
    >
      <SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>
        {visible.map((item) => (
          <SortableTreeItem
            key={item.id}
            item={item}
            depth={item.id === activeId && projected ? projected.depth : item.depth}
            isProjectedParent={!!projected && item.id === projected.parentId}
            renderRowEnd={renderRowEnd}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableTreeItem({
  item,
  depth,
  isProjectedParent,
  renderRowEnd,
}: {
  item: MigrationFlatItem;
  depth: number;
  isProjectedParent?: boolean;
  renderRowEnd?: (id: string) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  const PageIcon = pageTypeIcon(item.type);
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? undefined,
    paddingLeft: BASE_PAD + depth * INDENT,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        styles.row,
        isDragging && styles.rowActive,
        isProjectedParent && styles.rowParent,
      )}
    >
      <span
        ref={setActivatorNodeRef}
        className={styles.handle}
        aria-label={`Reorder ${item.title}`}
        {...attributes}
        {...listeners}
      >
        <DotsSixVerticalOutlined size="xxx-small" variant="subtle" />
      </span>
      <PageIcon size="xxx-small" variant="subtle" />
      <span className={styles.title}>{item.title}</span>
      {renderRowEnd && <span className={styles.end}>{renderRowEnd(item.id)}</span>}
    </div>
  );
}
