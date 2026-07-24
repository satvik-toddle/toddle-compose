import { FONT_FAMILY } from '@excalidraw/excalidraw';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform';
import type { FileId } from '@excalidraw/excalidraw/element/types';
import type { BinaryFileData, DataURL } from '@excalidraw/excalidraw/types';

// Converts a legacy Zwibbler workbook (flat node array) into Excalidraw skeletons +
// image files. Node mapping and rationale: docs/whiteboard-zwibbler-conversion.md.

export type ZwibblerNode = {
  type: string;
  id: number | string;
  parent?: number | string;
  // [a, b, c, d, tx, ty] affine transform
  matrix?: number[];
  width?: number;
  height?: number;
  points?: number[];
  text?: string;
  fillStyle?: string;
  strokeStyle?: string;
  textFillStyle?: string;
  lineWidth?: number;
  fontSize?: number;
  textAlign?: string;
  url?: string;
  fillMode?: string;
  _name?: string;
  _autoResize?: boolean;
};

export type ZwibblerExcalidrawConversion = {
  elements: ExcalidrawElementSkeleton[];
  files: BinaryFileData[];
  skipped: string[];
};

type Transform = { a: number; b: number; c: number; d: number; tx: number; ty: number };

const readTransform = (node: ZwibblerNode): Transform => {
  const [a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0] = node.matrix ?? [];
  return { a, b, c, d, tx, ty };
};

const scaleX = (transform: Transform) => Math.hypot(transform.a, transform.b);
const scaleY = (transform: Transform) => Math.hypot(transform.c, transform.d);
const rotationOf = (transform: Transform) => Math.atan2(transform.b, transform.a);

const svgDimensions = (svg: string): { width: number; height: number } | null => {
  const widthMatch = /<svg[^>]*\swidth="([\d.]+)"/.exec(svg);
  const heightMatch = /<svg[^>]*\sheight="([\d.]+)"/.exec(svg);
  if (widthMatch && heightMatch) return { width: +widthMatch[1], height: +heightMatch[1] };
  const viewBoxMatch = /<svg[^>]*\sviewBox="[\d.-]+[ ,]+[\d.-]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(svg);
  return viewBoxMatch ? { width: +viewBoxMatch[1], height: +viewBoxMatch[2] } : null;
};

// One file per unique (url, tint); image elements share it.
const svgKey = (node: ZwibblerNode) =>
  `${node.url}|${node.fillMode === 'custom' ? (node.fillStyle ?? '') : ''}`;

type SvgFile = { fileId: FileId; aspect: number };

const loadSvgFiles = async (
  nodes: ZwibblerNode[],
): Promise<{ files: BinaryFileData[]; fileByKey: Map<string, SvgFile> }> => {
  const svgNodes = nodes.filter((node) => node.type === 'SvgNode' && typeof node.url === 'string');
  const svgTextByUrl = new Map<string, string | null>();
  await Promise.all(
    [...new Set(svgNodes.map((node) => node.url!))].map(async (url) => {
      try {
        const response = await fetch(url);
        svgTextByUrl.set(url, response.ok ? await response.text() : null);
      } catch {
        svgTextByUrl.set(url, null);
      }
    }),
  );

  const files: BinaryFileData[] = [];
  const fileByKey = new Map<string, SvgFile>();
  for (const node of svgNodes) {
    const key = svgKey(node);
    if (fileByKey.has(key)) continue;
    const rawSvg = svgTextByUrl.get(node.url!);
    if (!rawSvg) continue;
    // Zwibbler's "custom" fill mode repaints path fills with fillStyle.
    const tint = node.fillMode === 'custom' ? node.fillStyle : undefined;
    const tintedSvg = tint ? rawSvg.replace(/fill="#[0-9a-fA-F]{3,8}"/g, `fill="${tint}"`) : rawSvg;
    const dimensions = svgDimensions(rawSvg) ?? { width: 100, height: 100 };
    const fileId = `zw-svg-${files.length}` as FileId;
    files.push({
      id: fileId,
      dataURL: `data:image/svg+xml,${encodeURIComponent(tintedSvg)}` as DataURL,
      mimeType: 'image/svg+xml',
      created: 0,
    });
    fileByKey.set(key, { fileId, aspect: dimensions.height / dimensions.width });
  }
  return { files, fileByKey };
};

const convertSvgNode = (
  node: ZwibblerNode,
  transform: Transform,
  file: SvgFile,
): ExcalidrawElementSkeleton => {
  const width = (node.width ?? 100) * scaleX(transform);
  return {
    type: 'image',
    fileId: file.fileId,
    x: transform.tx,
    y: transform.ty,
    width,
    height: (node.width ?? 100) * file.aspect * scaleY(transform),
    angle: rotationOf(transform) as ExcalidrawElementSkeleton['angle'],
  };
};

// Missing-asset fallback: a plain rectangle of the fill color at the same box.
const convertSvgFallback = (node: ZwibblerNode, transform: Transform): ExcalidrawElementSkeleton => {
  const width = (node.width ?? 100) * scaleX(transform);
  return {
    type: 'rectangle',
    x: transform.tx,
    y: transform.ty,
    width,
    height: width,
    backgroundColor: node.fillStyle ?? '#cccccc',
    fillStyle: 'solid',
  };
};

const convertTextNode = (node: ZwibblerNode, transform: Transform): ExcalidrawElementSkeleton => ({
  type: 'text',
  text: node.text ?? '',
  x: transform.tx,
  y: transform.ty,
  fontSize: (node.fontSize ?? 24) * scaleX(transform),
  fontFamily: FONT_FAMILY.Nunito, // workbooks used Nunito Sans; excalidraw bundles Nunito
  strokeColor: node.textFillStyle ?? node.fillStyle ?? '#222222',
  textAlign: node.textAlign === 'center' ? 'center' : node.textAlign === 'right' ? 'right' : 'left',
  angle: rotationOf(transform) as ExcalidrawElementSkeleton['angle'],
});

// Freedraw isn't in the skeleton API, so a brush stroke maps to an equivalent dense line.
const convertBrushNode = (
  node: ZwibblerNode,
  transform: Transform,
): ExcalidrawElementSkeleton | null => {
  const flatPoints = node.points ?? [];
  if (flatPoints.length < 4) return null;
  const points: [number, number][] = [];
  for (let i = 0; i + 1 < flatPoints.length; i += 2) {
    const x = flatPoints[i];
    const y = flatPoints[i + 1];
    points.push([
      transform.a * x + transform.c * y + transform.tx,
      transform.b * x + transform.d * y + transform.ty,
    ]);
  }
  const [originX, originY] = points[0];
  return {
    type: 'line',
    x: originX,
    y: originY,
    points: points.map(([x, y]) => [x - originX, y - originY]) as never,
    strokeColor: node.strokeStyle ?? node.fillStyle ?? '#222222',
    strokeWidth: (node.lineWidth ?? 4) * scaleX(transform),
    roughness: 0,
  };
};

// Pages have no bounded frames; each contributes an x-offset so they flow left-to-right.
const buildPageOffsets = (nodes: ZwibblerNode[]): Map<ZwibblerNode['id'], number> => {
  const PAGE_GAP = 80;
  const pageOffsets = new Map<ZwibblerNode['id'], number>();
  let nextPageX = 0;
  for (const node of nodes) {
    if (node.type !== 'PageNode') continue;
    pageOffsets.set(node.id, nextPageX);
    nextPageX += (node.width ?? 800) + PAGE_GAP;
  }
  return pageOffsets;
};

export const zwibblerToExcalidraw = async (
  nodes: ZwibblerNode[],
): Promise<ZwibblerExcalidrawConversion> => {
  const elements: ExcalidrawElementSkeleton[] = [];
  const skipped: string[] = [];
  const { files, fileByKey } = await loadSvgFiles(nodes);
  const pageOffsets = buildPageOffsets(nodes);

  for (const node of nodes) {
    if (node.type === 'PageNode' || node.type === 'BaseNode') continue;
    const transform = readTransform(node);
    let element: ExcalidrawElementSkeleton | null = null;
    if (node.type === 'SvgNode') {
      const file = fileByKey.get(svgKey(node));
      element = file ? convertSvgNode(node, transform, file) : convertSvgFallback(node, transform);
    } else if (node.type === 'TextNode') {
      element = convertTextNode(node, transform);
    } else if (node.type === 'BrushNode') {
      element = convertBrushNode(node, transform);
    } else {
      skipped.push(node.type);
    }
    if (!element) continue;
    const pageOffset = node.parent != null ? (pageOffsets.get(node.parent) ?? 0) : 0;
    if (pageOffset) element = { ...element, x: (element.x ?? 0) + pageOffset };
    elements.push(element);
  }

  return { elements, files, skipped };
};
