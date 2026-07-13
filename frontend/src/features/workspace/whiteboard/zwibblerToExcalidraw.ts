import { FONT_FAMILY } from '@excalidraw/excalidraw';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform';
import type { FileId } from '@excalidraw/excalidraw/element/types';
import type { BinaryFileData, DataURL } from '@excalidraw/excalidraw/types';
import type { ZwibblerNode } from './zwibblerToTldraw';

// Converts a legacy Zwibbler workbook document into Excalidraw element skeletons
// (for convertToExcalidrawElements) plus the binary files backing image elements.
//
// Mapping: PageNode → x-offset (pages flow left-to-right), SvgNode → image
// element backed by the tinted workbook SVG as a data-URI file, TextNode → text,
// BrushNode → line (freedraw isn't in the skeleton API; a dense polyline is
// visually equivalent). Excalidraw takes arbitrary hex colors, so fills and
// strokes keep their exact workbook values — no palette snapping.

export type ZwibblerExcalidrawConversion = {
  elements: ExcalidrawElementSkeleton[];
  files: BinaryFileData[];
  skipped: string[];
};

type Xform = { a: number; b: number; c: number; d: number; tx: number; ty: number };

function xform(node: ZwibblerNode): Xform {
  const [a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0] = node.matrix ?? [];
  return { a, b, c, d, tx, ty };
}

const scaleX = (m: Xform) => Math.hypot(m.a, m.b);
const scaleY = (m: Xform) => Math.hypot(m.c, m.d);
const angle = (m: Xform) => Math.atan2(m.b, m.a);

function svgDimensions(svg: string): { w: number; h: number } | null {
  const wm = /<svg[^>]*\swidth="([\d.]+)"/.exec(svg);
  const hm = /<svg[^>]*\sheight="([\d.]+)"/.exec(svg);
  if (wm && hm) return { w: +wm[1], h: +hm[1] };
  const vb = /<svg[^>]*\sviewBox="[\d.-]+[ ,]+[\d.-]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(svg);
  return vb ? { w: +vb[1], h: +vb[2] } : null;
}

// One file per unique (url, tint); image elements share it.
const svgKey = (node: ZwibblerNode) =>
  `${node.url}|${node.fillMode === 'custom' ? (node.fillStyle ?? '') : ''}`;

type SvgFile = { fileId: FileId; aspect: number };

async function loadSvgFiles(
  nodes: ZwibblerNode[],
): Promise<{ files: BinaryFileData[]; byKey: Map<string, SvgFile> }> {
  const svgNodes = nodes.filter((n) => n.type === 'SvgNode' && typeof n.url === 'string');
  const texts = new Map<string, string | null>();
  await Promise.all(
    [...new Set(svgNodes.map((n) => n.url!))].map(async (url) => {
      try {
        const res = await fetch(url);
        texts.set(url, res.ok ? await res.text() : null);
      } catch {
        texts.set(url, null);
      }
    }),
  );

  const files: BinaryFileData[] = [];
  const byKey = new Map<string, SvgFile>();
  for (const node of svgNodes) {
    const key = svgKey(node);
    if (byKey.has(key)) continue;
    const raw = texts.get(node.url!);
    if (!raw) continue;
    const tint = node.fillMode === 'custom' ? node.fillStyle : undefined;
    const svg = tint ? raw.replace(/fill="#[0-9a-fA-F]{3,8}"/g, `fill="${tint}"`) : raw;
    const dims = svgDimensions(raw) ?? { w: 100, h: 100 };
    const fileId = `zw-svg-${files.length}` as FileId;
    files.push({
      id: fileId,
      dataURL: `data:image/svg+xml,${encodeURIComponent(svg)}` as DataURL,
      mimeType: 'image/svg+xml',
      created: 0,
    });
    byKey.set(key, { fileId, aspect: dims.h / dims.w });
  }
  return { files, byKey };
}

function convertSvgNode(node: ZwibblerNode, m: Xform, file: SvgFile): ExcalidrawElementSkeleton {
  const w = (node.width ?? 100) * scaleX(m);
  return {
    type: 'image',
    fileId: file.fileId,
    x: m.tx,
    y: m.ty,
    width: w,
    height: (node.width ?? 100) * file.aspect * scaleY(m),
    angle: angle(m) as ExcalidrawElementSkeleton['angle'],
  };
}

// Missing-asset fallback: a plain rectangle of the fill color at the same box.
function convertSvgFallback(node: ZwibblerNode, m: Xform): ExcalidrawElementSkeleton {
  const w = (node.width ?? 100) * scaleX(m);
  return {
    type: 'rectangle',
    x: m.tx,
    y: m.ty,
    width: w,
    height: w,
    backgroundColor: node.fillStyle ?? '#cccccc',
    fillStyle: 'solid',
  };
}

function convertTextNode(node: ZwibblerNode, m: Xform): ExcalidrawElementSkeleton {
  return {
    type: 'text',
    text: node.text ?? '',
    x: m.tx,
    y: m.ty,
    fontSize: (node.fontSize ?? 24) * scaleX(m),
    fontFamily: FONT_FAMILY.Nunito, // workbooks used Nunito Sans; excalidraw bundles Nunito
    strokeColor: node.textFillStyle ?? node.fillStyle ?? '#222222',
    textAlign: node.textAlign === 'center' ? 'center' : node.textAlign === 'right' ? 'right' : 'left',
    angle: angle(m) as ExcalidrawElementSkeleton['angle'],
  };
}

function convertBrushNode(node: ZwibblerNode, m: Xform): ExcalidrawElementSkeleton | null {
  const flat = node.points ?? [];
  if (flat.length < 4) return null;
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const [x, y] = [flat[i], flat[i + 1]];
    pts.push([m.a * x + m.c * y + m.tx, m.b * x + m.d * y + m.ty]);
  }
  const [ox, oy] = pts[0];
  return {
    type: 'line',
    x: ox,
    y: oy,
    points: pts.map(([x, y]) => [x - ox, y - oy]) as never,
    strokeColor: node.strokeStyle ?? node.fillStyle ?? '#222222',
    strokeWidth: (node.lineWidth ?? 4) * scaleX(m),
    roughness: 0,
  };
}

export async function zwibblerToExcalidraw(
  nodes: ZwibblerNode[],
): Promise<ZwibblerExcalidrawConversion> {
  const elements: ExcalidrawElementSkeleton[] = [];
  const skipped: string[] = [];
  const { files, byKey } = await loadSvgFiles(nodes);

  const PAGE_GAP = 80;
  const pageOffsets = new Map<ZwibblerNode['id'], number>();
  let pageX = 0;
  for (const node of nodes) {
    if (node.type !== 'PageNode') continue;
    pageOffsets.set(node.id, pageX);
    pageX += (node.width ?? 800) + PAGE_GAP;
  }

  for (const node of nodes) {
    if (node.type === 'PageNode' || node.type === 'BaseNode') continue;
    const m = xform(node);
    let element: ExcalidrawElementSkeleton | null = null;
    if (node.type === 'SvgNode') {
      const file = byKey.get(svgKey(node));
      element = file ? convertSvgNode(node, m, file) : convertSvgFallback(node, m);
    } else if (node.type === 'TextNode') element = convertTextNode(node, m);
    else if (node.type === 'BrushNode') element = convertBrushNode(node, m);
    else skipped.push(node.type);
    if (!element) continue;
    const dx = node.parent != null ? (pageOffsets.get(node.parent) ?? 0) : 0;
    if (dx) element = { ...element, x: (element.x ?? 0) + dx };
    elements.push(element);
  }

  return { elements, files, skipped };
}
