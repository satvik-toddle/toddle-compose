import {
  AssetRecordType,
  compressLegacySegments,
  createShapeId,
  toRichText,
  type TLAsset,
  type TLAssetId,
  type TLDefaultColorStyle,
  type TLDefaultSizeStyle,
  type TLGeoShape,
  type TLShapePartial,
} from 'tldraw';
import { WHITEBOARD_SOLIDS } from '../whiteboardTheme';

// Converts a legacy Zwibbler workbook (flat node array) into tldraw shapes.
// Node mapping and rationale: docs/whiteboard-zwibbler-conversion.md.

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

export type ZwibblerConversion = {
  shapes: TLShapePartial[];
  assets: TLAsset[];
  // Zwibbler node types we had no mapping for
  skipped: string[];
};

const STROKE_SIZES: Record<TLDefaultSizeStyle, number> = { s: 2, m: 3.5, l: 5, xl: 10 };
const FONT_SIZES: Record<TLDefaultSizeStyle, number> = { s: 18, m: 24, l: 36, xl: 44 };

// Zwibbler SvgNode assets → tldraw geo type + the asset's viewBox aspect (h/w),
// since Zwibbler only persists the width.
type GeoType = TLGeoShape['props']['geo'];

const GEO_BY_NAME: Record<string, { geo: GeoType; aspect: number }> = {
  hexagon: { geo: 'hexagon', aspect: 63 / 52 },
  heart: { geo: 'heart', aspect: 54 / 64 },
  cloud: { geo: 'cloud', aspect: 62 / 64 },
  star: { geo: 'star', aspect: 1 },
  triangle: { geo: 'triangle', aspect: 1 },
  square: { geo: 'rectangle', aspect: 1 },
  rectangle: { geo: 'rectangle', aspect: 1 },
  circle: { geo: 'ellipse', aspect: 1 },
  ellipse: { geo: 'ellipse', aspect: 1 },
  diamond: { geo: 'diamond', aspect: 1 },
  pentagon: { geo: 'pentagon', aspect: 1 },
  octagon: { geo: 'octagon', aspect: 1 },
  oval: { geo: 'oval', aspect: 0.5 },
  trapezoid: { geo: 'trapezoid', aspect: 1 },
};

// CSS named colors legacy Zwibbler docs are known to use (beyond WHITEBOARD_SOLIDS keys).
const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  gray: '#808080',
  grey: '#808080',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  violet: '#ee82ee',
  indigo: '#4b0082',
  lime: '#00ff00',
  navy: '#000080',
  teal: '#008080',
  maroon: '#800000',
  olive: '#808000',
  silver: '#c0c0c0',
  gold: '#ffd700',
};

// #rgb[a], #rrggbb[aa], rgb()/rgba(), and common named colors; alpha is ignored.
function parseColor(color: string | undefined): [number, number, number] | null {
  if (!color) return null;
  let c = color.trim().toLowerCase();
  c = NAMED_COLORS[c] ?? c;
  const short = /^#([0-9a-f]{3,4})$/.exec(c);
  if (short) {
    const [r, g, b] = short[1];
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)];
  }
  const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(c);
  if (long) {
    const n = parseInt(long[1], 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(c);
  if (rgb) {
    return [Math.min(255, +rgb[1]), Math.min(255, +rgb[2]), Math.min(255, +rgb[3])];
  }
  return null;
}

const SOLID_RGB = Object.entries(WHITEBOARD_SOLIDS).map(
  ([name, hex]) => [name, parseColor(hex)!] as const,
);

function nearestColor(color: string | undefined): TLDefaultColorStyle {
  if (color && color in WHITEBOARD_SOLIDS) return color as TLDefaultColorStyle;
  const rgb = parseColor(color);
  if (!rgb) return 'black';
  let best: string = 'black';
  let bestDist = Infinity;
  for (const [name, p] of SOLID_RGB) {
    const dist = (rgb[0] - p[0]) ** 2 + (rgb[1] - p[1]) ** 2 + (rgb[2] - p[2]) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }
  return best as TLDefaultColorStyle;
}

function nearestSize(
  value: number,
  scale: Record<TLDefaultSizeStyle, number>,
): TLDefaultSizeStyle {
  let best: TLDefaultSizeStyle = 's';
  let bestDist = Infinity;
  for (const [name, px] of Object.entries(scale) as [TLDefaultSizeStyle, number][]) {
    const dist = Math.abs(value - px);
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }
  return best;
}

type Xform = { a: number; b: number; c: number; d: number; tx: number; ty: number };

function xform(node: ZwibblerNode): Xform {
  const [a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0] = node.matrix ?? [];
  return { a, b, c, d, tx, ty };
}

const scaleX = (m: Xform) => Math.hypot(m.a, m.b);
const scaleY = (m: Xform) => Math.hypot(m.c, m.d);

type SvgAsset = { assetId: TLAssetId; aspect: number };

// One asset per unique (url, tint); image shapes share it.
const svgKey = (node: ZwibblerNode) =>
  `${node.url}|${node.fillMode === 'custom' ? (node.fillStyle ?? '') : ''}`;

function svgDimensions(svg: string): { w: number; h: number } | null {
  const wm = /<svg[^>]*\swidth="([\d.]+)"/.exec(svg);
  const hm = /<svg[^>]*\sheight="([\d.]+)"/.exec(svg);
  if (wm && hm) return { w: +wm[1], h: +hm[1] };
  const vb = /<svg[^>]*\sviewBox="[\d.-]+[ ,]+[\d.-]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(svg);
  return vb ? { w: +vb[1], h: +vb[2] } : null;
}

// Fetches each SVG once, then one tinted data-URI asset per unique (url, tint).
// Zwibbler's "custom" fill mode repaints path fills with fillStyle; same here.
async function loadSvgAssets(
  nodes: ZwibblerNode[],
): Promise<{ assets: TLAsset[]; byKey: Map<string, SvgAsset> }> {
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

  const assets: TLAsset[] = [];
  const byKey = new Map<string, SvgAsset>();
  for (const node of svgNodes) {
    const key = svgKey(node);
    if (byKey.has(key)) continue;
    const raw = texts.get(node.url!);
    if (!raw) continue;
    const tint = node.fillMode === 'custom' ? node.fillStyle : undefined;
    const svg = tint ? raw.replace(/fill="#[0-9a-fA-F]{3,8}"/g, `fill="${tint}"`) : raw;
    const dims = svgDimensions(raw) ?? { w: 100, h: 100 };
    const assetId = AssetRecordType.createId(`zw-svg-${assets.length}`);
    assets.push(
      AssetRecordType.create({
        id: assetId,
        type: 'image',
        props: {
          src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
          w: dims.w,
          h: dims.h,
          name: node._name ?? 'shape',
          mimeType: 'image/svg+xml',
          isAnimated: false,
        },
      }),
    );
    byKey.set(key, { assetId, aspect: dims.h / dims.w });
  }
  return { assets, byKey };
}

function convertSvgImage(node: ZwibblerNode, m: Xform, asset: SvgAsset): TLShapePartial {
  const w = (node.width ?? 100) * scaleX(m);
  return {
    id: createShapeId(`zw-${node.id}`),
    type: 'image',
    x: m.tx,
    y: m.ty,
    rotation: Math.atan2(m.b, m.a),
    props: {
      assetId: asset.assetId,
      w,
      h: (node.width ?? 100) * asset.aspect * scaleY(m),
    },
  };
}

function convertSvgNode(node: ZwibblerNode, m: Xform): TLShapePartial {
  const { geo, aspect } = GEO_BY_NAME[node._name ?? ''] ?? { geo: 'rectangle', aspect: 1 };
  const w = (node.width ?? 100) * scaleX(m);
  return {
    id: createShapeId(`zw-${node.id}`),
    type: 'geo',
    x: m.tx,
    y: m.ty,
    rotation: Math.atan2(m.b, m.a),
    props: {
      geo,
      w,
      h: (node.width ?? 100) * aspect * scaleY(m),
      color: nearestColor(node.fillStyle),
      fill: 'fill',
      dash: 'solid',
      size: nearestSize((node.lineWidth ?? 1) * scaleX(m), STROKE_SIZES),
    },
  };
}

function convertTextNode(node: ZwibblerNode, m: Xform): TLShapePartial {
  const effSize = (node.fontSize ?? 24) * scaleX(m);
  const size = nearestSize(effSize, FONT_SIZES);
  const shapeScale = effSize / FONT_SIZES[size];
  const align = node.textAlign === 'center' ? 'middle' : node.textAlign === 'right' ? 'end' : 'start';
  return {
    id: createShapeId(`zw-${node.id}`),
    type: 'text',
    x: m.tx,
    y: m.ty,
    rotation: Math.atan2(m.b, m.a),
    props: {
      richText: toRichText(node.text ?? ''),
      color: nearestColor(node.textFillStyle ?? node.fillStyle),
      size,
      scale: shapeScale,
      font: 'sans',
      textAlign: align,
      autoSize: node._autoResize !== false,
      w: ((node.width ?? 200) * scaleX(m)) / shapeScale,
    },
  };
}

function convertBrushNode(node: ZwibblerNode, m: Xform): TLShapePartial | null {
  const flat = node.points ?? [];
  if (flat.length < 2) return null;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const x = flat[i];
    const y = flat[i + 1];
    pts.push({ x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty });
  }
  const origin = pts[0];
  return {
    id: createShapeId(`zw-${node.id}`),
    type: 'draw',
    x: origin.x,
    y: origin.y,
    props: {
      segments: compressLegacySegments([
        {
          type: 'free',
          points: pts.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y, z: 0.5 })),
        },
      ]),
      color: nearestColor(node.strokeStyle ?? node.fillStyle),
      size: nearestSize((node.lineWidth ?? 4) * scaleX(m), STROKE_SIZES),
      dash: 'draw',
      fill: 'none',
      isComplete: true,
      isClosed: false,
      isPen: false,
    },
  };
}

export async function zwibblerToTldraw(nodes: ZwibblerNode[]): Promise<ZwibblerConversion> {
  const shapes: TLShapePartial[] = [];
  const skipped = new Set<string>();
  const { assets, byKey } = await loadSvgAssets(nodes);

  // No frames — each page is just an x-offset so pages flow left-to-right.
  const PAGE_GAP = 80;
  const pageOffsets = new Map<ZwibblerNode['id'], number>();
  let pageX = 0;
  for (const node of nodes) {
    if (node.type !== 'PageNode') continue;
    pageOffsets.set(node.id, pageX);
    pageX += (node.width ?? 800) + PAGE_GAP;
  }

  // Walk the parent chain to the owning PageNode: containers (e.g. GroupNode) sit
  // between shapes and their page.
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const pageOffsetOf = (node: ZwibblerNode): number => {
    const seen = new Set<ZwibblerNode['id']>();
    for (let id = node.parent; id != null && !seen.has(id); ) {
      const off = pageOffsets.get(id);
      if (off !== undefined) return off;
      seen.add(id);
      id = nodeById.get(id)?.parent;
    }
    return 0;
  };

  for (const node of nodes) {
    if (node.type === 'PageNode' || node.type === 'BaseNode') continue;
    const m = xform(node);
    let shape: TLShapePartial | null = null;
    if (node.type === 'SvgNode') {
      const asset = byKey.get(svgKey(node));
      shape = asset ? convertSvgImage(node, m, asset) : convertSvgNode(node, m);
    } else if (node.type === 'TextNode') shape = convertTextNode(node, m);
    else if (node.type === 'BrushNode') shape = convertBrushNode(node, m);
    else skipped.add(node.type);
    if (!shape) continue;
    const dx = pageOffsetOf(node);
    if (dx) shape.x = (shape.x ?? 0) + dx;
    shapes.push(shape);
  }

  return { shapes, assets, skipped: [...skipped] };
}
