import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { getCommonBounds } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { useThemeStore } from '../../../stores/themeStore';

// Breathing room around the content/viewport union so nothing sits on the edge.
const WORLD_PADDING_RATIO = 0.1;

const styles = {
  minimap:
    'absolute top-3 right-3 z-10 h-[140px] w-[200px] cursor-pointer rounded-2 border border-secondary shadow-lg',
};

const MINIMAP_PALETTE = {
  light: { surface: 'rgba(255, 255, 255, 0.92)', element: 'rgba(15, 23, 42, 0.35)', viewport: '#4465e9' },
  dark: { surface: 'rgba(32, 33, 36, 0.92)', element: 'rgba(226, 232, 240, 0.45)', viewport: '#7c93f5' },
};

type Rect = { x: number; y: number; width: number; height: number };
// Maps scene coordinates onto the minimap: minimapPx = scene * scale + offset.
type Projection = { scale: number; offsetX: number; offsetY: number };
type ExcalidrawAppState = ReturnType<ExcalidrawImperativeAPI['getAppState']>;

const getViewportSceneRect = (appState: ExcalidrawAppState): Rect => {
  const zoom = appState.zoom.value;
  return {
    x: -appState.scrollX,
    y: -appState.scrollY,
    width: appState.width / zoom,
    height: appState.height / zoom,
  };
};

const unionRect = (a: Rect, b: Rect): Rect => {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

const padRect = (rect: Rect, ratio: number): Rect => {
  const padX = rect.width * ratio;
  const padY = rect.height * ratio;
  return { x: rect.x - padX, y: rect.y - padY, width: rect.width + padX * 2, height: rect.height + padY * 2 };
};

// Fits the world into the minimap, centered, preserving aspect ratio.
const createProjection = (world: Rect, viewWidth: number, viewHeight: number): Projection => {
  const scale = Math.min(viewWidth / world.width, viewHeight / world.height);
  const offsetX = (viewWidth - world.width * scale) / 2 - world.x * scale;
  const offsetY = (viewHeight - world.height * scale) / 2 - world.y * scale;
  return { scale, offsetX, offsetY };
};

const projectX = (projection: Projection, sceneX: number) => sceneX * projection.scale + projection.offsetX;
const projectY = (projection: Projection, sceneY: number) => sceneY * projection.scale + projection.offsetY;

// The element fields the minimap draws from; points carry linear/freedraw geometry.
type MinimapElement = {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  points?: readonly (readonly [number, number])[];
};

// Lines, arrows and freedraw are polylines whose points are relative to the element origin.
const drawPolyline = (context: CanvasRenderingContext2D, projection: Projection, element: MinimapElement) => {
  const points = element.points;
  if (!points || points.length < 2) return;
  context.beginPath();
  points.forEach(([localX, localY], index) => {
    const x = projectX(projection, element.x + localX);
    const y = projectY(projection, element.y + localY);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
};

// Draws one element with type-appropriate geometry, rotated about its center.
const drawElement = (context: CanvasRenderingContext2D, projection: Projection, element: MinimapElement) => {
  if (element.type === 'line' || element.type === 'arrow' || element.type === 'freedraw') {
    drawPolyline(context, projection, element);
    return;
  }

  const width = Math.max(1, element.width * projection.scale);
  const height = Math.max(1, element.height * projection.scale);
  const centerX = projectX(projection, element.x + element.width / 2);
  const centerY = projectY(projection, element.y + element.height / 2);

  context.save();
  context.translate(centerX, centerY);
  context.rotate(element.angle || 0);
  if (element.type === 'ellipse') {
    context.beginPath();
    context.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
    context.fill();
  } else if (element.type === 'diamond') {
    context.beginPath();
    context.moveTo(0, -height / 2);
    context.lineTo(width / 2, 0);
    context.lineTo(0, height / 2);
    context.lineTo(-width / 2, 0);
    context.closePath();
    context.fill();
  } else {
    context.fillRect(-width / 2, -height / 2, width, height);
  }
  context.restore();
};

type WhiteboardMinimapProps = { api: ExcalidrawImperativeAPI };

// Overview + click/drag navigation that Excalidraw lacks natively (tldraw had it built in).
export function WhiteboardMinimap({ api }: Readonly<WhiteboardMinimapProps>) {
  const isDark = useThemeStore((s) => s.isDark);
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const projectionRef = useRef<Projection | null>(null);
  // Frozen at drag start so redraws (which refit the world) don't shift the mapping mid-drag.
  const dragProjectionRef = useRef<Projection | null>(null);
  const scheduleDrawRef = useRef<() => void>(() => {});

  useEffect(() => {
    let pendingFrame = 0;

    const draw = () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return;

      const elements = api.getSceneElements();
      const appState = api.getAppState();
      const viewportRect = getViewportSceneRect(appState);

      let world = viewportRect;
      if (elements.length) {
        const [minX, minY, maxX, maxY] = getCommonBounds(elements);
        world = unionRect(world, { x: minX, y: minY, width: maxX - minX, height: maxY - minY });
      }
      world = padRect(world, WORLD_PADDING_RATIO);
      if (world.width <= 0 || world.height <= 0) return;

      const devicePixelRatio = window.devicePixelRatio || 1;
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      const backingWidth = Math.round(cssWidth * devicePixelRatio);
      const backingHeight = Math.round(cssHeight * devicePixelRatio);
      if (canvas.width !== backingWidth) canvas.width = backingWidth;
      if (canvas.height !== backingHeight) canvas.height = backingHeight;

      const projection = createProjection(world, cssWidth, cssHeight);
      projectionRef.current = projection;
      const colors = isDarkRef.current ? MINIMAP_PALETTE.dark : MINIMAP_PALETTE.light;

      context.save();
      context.scale(devicePixelRatio, devicePixelRatio);

      context.fillStyle = colors.surface;
      context.fillRect(0, 0, cssWidth, cssHeight);

      context.save();
      context.fillStyle = colors.element;
      context.strokeStyle = colors.element;
      context.lineWidth = 1;
      for (const element of elements as readonly MinimapElement[]) {
        drawElement(context, projection, element);
      }
      context.restore();

      context.save();
      context.strokeStyle = colors.viewport;
      context.fillStyle = `${colors.viewport}22`;
      context.lineWidth = 1.5;
      const viewportX = projectX(projection, viewportRect.x);
      const viewportY = projectY(projection, viewportRect.y);
      const viewportWidth = viewportRect.width * projection.scale;
      const viewportHeight = viewportRect.height * projection.scale;
      context.fillRect(viewportX, viewportY, viewportWidth, viewportHeight);
      context.strokeRect(viewportX, viewportY, viewportWidth, viewportHeight);
      context.restore();

      context.restore();
    };

    // Coalesce bursts of changes (onChange fires on every pointer move) to one draw per frame.
    const scheduleDraw = () => {
      if (pendingFrame) return;
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = 0;
        draw();
      });
    };
    scheduleDrawRef.current = scheduleDraw;

    scheduleDraw();
    const unsubscribeChange = api.onChange(scheduleDraw);
    const unsubscribeScroll = api.onScrollChange(scheduleDraw);

    return () => {
      if (pendingFrame) cancelAnimationFrame(pendingFrame);
      unsubscribeChange();
      unsubscribeScroll();
    };
  }, [api]);

  // Repaint on theme flip (colors come from the isDark ref inside draw).
  useEffect(() => {
    scheduleDrawRef.current();
  }, [isDark]);

  // Centers the canvas viewport on the scene point under the pointer.
  const panToPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const projection = dragProjectionRef.current;
    if (!projection) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const sceneX = (event.clientX - bounds.left - projection.offsetX) / projection.scale;
    const sceneY = (event.clientY - bounds.top - projection.offsetY) / projection.scale;
    const appState = api.getAppState();
    const zoom = appState.zoom.value;
    api.updateScene({
      appState: {
        scrollX: appState.width / zoom / 2 - sceneX,
        scrollY: appState.height / zoom / 2 - sceneY,
      },
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!projectionRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragProjectionRef.current = projectionRef.current;
    panToPointer(event);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragProjectionRef.current) panToPointer(event);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    dragProjectionRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <canvas
      ref={canvasRef}
      className={styles.minimap}
      aria-label="Whiteboard minimap"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  );
}
