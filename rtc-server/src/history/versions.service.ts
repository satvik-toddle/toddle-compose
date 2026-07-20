import { Injectable } from "@nestjs/common";
import * as Y from "yjs";
import { DocRepository } from "../persistence/doc-repository.service";
import { LexicalExtractService } from "../persistence/lexical-extract.service";
import { createLogger } from "../logger";
import { diffEditorStates, SerializedEditorState } from "./doc-diff";

const log = createLogger("versions");

// Sibling Yjs map holding uploadId -> { url } (doc-editor's UploadRegistry); outside the Lexical tree, so extraction alone misses it.
const UPLOAD_REGISTRY_KEY = "tde-upload-registry";

// Bake registry-resolved upload URLs into extracted node JSON: the frontend renders this state with no Y.Doc attached, so a registry-backed embed/image would otherwise have an empty src.
function materializeUploadSrcs(node: unknown, registry: Map<string, string>): void {
  if (!node || typeof node !== "object") return;
  const n = node as { uploadId?: string; src?: string; children?: unknown[] };
  if (n.uploadId && !n.src) {
    const url = registry.get(n.uploadId);
    if (url) n.src = url;
  }
  if (Array.isArray(n.children)) {
    for (const child of n.children) materializeUploadSrcs(child, registry);
  }
}

// Registry entries from a reconstructed Y.Doc (empty map when the doc predates any upload).
function readUploadRegistry(ydoc: Y.Doc): Map<string, string> {
  const out = new Map<string, string>();
  ydoc.getMap(UPLOAD_REGISTRY_KEY).forEach((value, key) => {
    const url = (value as { url?: string } | null)?.url;
    if (url) out.set(key, url);
  });
  return out;
}

// Sheet Yjs model (mirrors frontend sheetModel): 'rows' Array of per-row Y.Map keyed by '__id', 'colTypes' Map of column uuid -> { type, order } (stored opaquely here). DOC docs have no 'rows' root.
const ROWS_KEY = "rows";
const ID_KEY = "__id";
const COL_TYPE_KEY = "colTypes";

// Which slice the caller reads, so we skip the rest (see previewAtSeq): 'all' = everything; 'state' = yjs bytes only (legacy DOC render); 'render' = materialized lexicalJson (+ optional diffJson) only (DOC render); 'text' = sheet snapshot only (SHEET render).
export type PreviewInclude = "all" | "state" | "render" | "text";

export type SheetSnapshot = {
  rows: Array<{ rowId: string | null; values: Record<string, unknown> }>;
  colTypes: Record<string, unknown>;
};

// Whiteboard Yjs model (mirrors frontend useYjsTldrawStore): 'tldraw' Map of TLRecords keyed by record id.
const TLDRAW_KEY = "tldraw";

export type WhiteboardSnapshot = {
  recordCount: number;
  shapeCount: number;
  pageCount: number;
};

export type VersionPreview = {
  docId: string;
  seq: number;
  headSeq: number;
  appliedUpdates: number;
  yjsStateBytes: number;
  lexicalJson: string | null;
  plainText: string;
  rawTexts: Record<string, string>;
  // SHEET docs only: reconstructed grid at this seq; null for DOCs.
  sheet: SheetSnapshot | null;
  // WHITEBOARD docs only: record/shape/page counts at this seq; null otherwise.
  whiteboard: WhiteboardSnapshot | null;
  // Full Yjs state at this seq (base64). The frontend binds it to a read-only
  // editor to render the snapshot through the exact live-collab path.
  yjsStateB64: string;
  // include='render' with diffAgainstSeq: merged editorState of diffAgainstSeq -> seq, changed runs/blocks wrapped in diff-mark nodes.
  diffJson: string | null;
  elapsedMs: number;
};

// Extract grid state (row id + cell values, column types) if this is a sheet; null for non-sheet docs.
export function extractSheet(ydoc: Y.Doc): SheetSnapshot | null {
  if (!ydoc.share.has(ROWS_KEY)) return null;
  const yrows = ydoc.getArray(ROWS_KEY);
  const ycolTypes = ydoc.getMap(COL_TYPE_KEY);
  const rows = yrows.toArray().map((item) => {
    const m = item as Y.Map<unknown>;
    const values: Record<string, unknown> = {};
    for (const k of m.keys()) {
      if (k !== ID_KEY) values[k] = m.get(k);
    }
    const id = m.get(ID_KEY);
    return { rowId: typeof id === "string" ? id : null, values };
  });
  const colTypes: Record<string, unknown> = {};
  for (const k of ycolTypes.keys()) colTypes[k] = ycolTypes.get(k);
  return { rows, colTypes };
}

// Whiteboard summary if this doc has the tldraw records root; null otherwise.
export function extractWhiteboard(ydoc: Y.Doc): WhiteboardSnapshot | null {
  if (!ydoc.share.has(TLDRAW_KEY)) return null;
  const yrecords = ydoc.getMap(TLDRAW_KEY);
  let shapeCount = 0;
  let pageCount = 0;
  for (const k of yrecords.keys()) {
    if (k.startsWith("shape:")) shapeCount += 1;
    else if (k.startsWith("page:")) pageCount += 1;
  }
  return { recordCount: yrecords.size, shapeCount, pageCount };
}

// Canonical whiteboard text for no-op detection: full record contents keyed by
// sorted id, so moves/resizes/recolors (count-preserving edits) register as changes.
export function whiteboardCanonicalText(ydoc: Y.Doc): string | null {
  if (!ydoc.share.has(TLDRAW_KEY)) return null;
  const yrecords = ydoc.getMap(TLDRAW_KEY);
  const records: Record<string, unknown> = {};
  for (const k of [...yrecords.keys()].sort()) records[k] = yrecords.get(k);
  return JSON.stringify(records);
}

@Injectable()
export class VersionsService {
  constructor(
    private readonly repo: DocRepository,
    private readonly extract: LexicalExtractService
  ) {}

  // Extract the doc's editorState with upload URLs baked in (see materializeUploadSrcs); null when extraction fails.
  private async renderState(ydoc: Y.Doc): Promise<SerializedEditorState | null> {
    const { lexicalJson } = await this.extract.extractFromBytes(
      Y.encodeStateAsUpdate(ydoc)
    );
    if (!lexicalJson) return null;
    const state = JSON.parse(lexicalJson) as SerializedEditorState;
    const registry = readUploadRegistry(ydoc);
    if (registry.size) materializeUploadSrcs(state.root, registry);
    return state;
  }

  async previewAtSeq(
    docId: string,
    seq: number,
    include: PreviewInclude = "all",
    // Baseline seq for include='render': also return the merged diff baseline -> seq (0 = empty doc).
    diffAgainstSeq: number | null = null
  ): Promise<VersionPreview> {
    const t0 = Date.now();
    const head = await this.repo.getHeadSeq(docId);
    const target = Math.max(0, Math.min(seq, head));
    // One blob fetch + one replay pass: the diff baseline is a prefix of the target replay, so it is snapshotted mid-pass instead of replaying the log twice.
    const blobs =
      target > 0 ? await this.repo.getDocUpdateBlobsUpTo(docId, target) : [];
    const ydoc = new Y.Doc();

    let lexicalJson: string | null = null;
    let diffJson: string | null = null;
    if (include === "render" && diffAgainstSeq != null) {
      const requested = Math.max(0, Math.min(diffAgainstSeq, target));
      // requested may fall inside a merged row's range; clamp up to the row that absorbed it (blobs sorted seq-asc) — clamping down could degrade to the empty doc and mark the whole doc added. 0 stays as the explicit empty-doc baseline; no row >= requested falls back to target (self-diff path).
      const baseSeq =
        requested === 0
          ? 0
          : (blobs.find((b) => b.seq >= requested)?.seq ?? target);
      let idx = 0;
      for (; idx < blobs.length && blobs[idx].seq <= baseSeq; idx++) {
        Y.applyUpdate(ydoc, new Uint8Array(blobs[idx].blob));
      }
      // baseSeq === target: baseline and target are the same state, so extract once and self-diff (no marks) instead of running the worker twice.
      const sameAsTarget = baseSeq === target;
      const baseState = sameAsTarget ? null : await this.renderState(ydoc);
      for (; idx < blobs.length; idx++) {
        Y.applyUpdate(ydoc, new Uint8Array(blobs[idx].blob));
      }
      const state = await this.renderState(ydoc);
      lexicalJson = state ? JSON.stringify(state) : null;
      if (state) {
        // An empty/failed baseline diffs against the empty doc (everything reads as added).
        const base = sameAsTarget
          ? state
          : baseState ?? { root: { type: "root", children: [] } };
        diffJson = JSON.stringify(diffEditorStates(base, state));
      }
    } else {
      for (const { blob } of blobs) {
        Y.applyUpdate(ydoc, new Uint8Array(blob));
      }
      if (include === "render") {
        const state = await this.renderState(ydoc);
        lexicalJson = state ? JSON.stringify(state) : null;
      }
    }

    // Extract sheet/whiteboard BEFORE the rawTexts getText() loop so it can't coerce their Array/Map roots to Y.Text; cheap and local, so run it in every mode.
    const sheet = extractSheet(ydoc);
    const whiteboard = extractWhiteboard(ydoc);

    // Only 'all' and 'state' read the yjs bytes; 'render'/'text' skip the O(doc) encode entirely.
    const yjsState =
      include === "all" || include === "state"
        ? Y.encodeStateAsUpdate(ydoc)
        : null;

    const rawTexts: Record<string, string> = {};
    let plainText = "";
    if (include === "all" && yjsState) {
      const extracted = await this.extract.extractFromBytes(yjsState);
      lexicalJson = extracted.lexicalJson;

      for (const key of ydoc.share.keys()) {
        try {
          const s = ydoc.getText(key).toString();
          if (s.length > 0) rawTexts[key] = s;
        } catch {
          /* not text-coercible (e.g. the sheet's Array/Map roots) */
        }
      }

      // Sheets/whiteboards yield empty lexical text, so use a canonical serialization; non-empty lexical text wins over the whiteboard fallback so a DOC with a stray tldraw root keeps text previews.
      const whiteboardText = whiteboardCanonicalText(ydoc);
      plainText = sheet
        ? JSON.stringify({ rows: sheet.rows, colTypes: sheet.colTypes })
        : extracted.plainText || whiteboardText || "";
    }

    const yjsStateB64 = yjsState ? Buffer.from(yjsState).toString("base64") : "";

    const elapsedMs = Date.now() - t0;
    log.debug(
      `preview '${docId}' seq=${target}/${head} include=${include} json=${lexicalJson?.length ?? 0}B diff=${diffJson?.length ?? 0}B in ${elapsedMs}ms`
    );
    return {
      docId,
      seq: target,
      headSeq: head,
      appliedUpdates: target,
      yjsStateBytes: yjsState?.byteLength ?? 0,
      lexicalJson,
      plainText,
      rawTexts,
      sheet,
      whiteboard,
      yjsStateB64,
      diffJson,
      elapsedMs,
    };
  }
}
