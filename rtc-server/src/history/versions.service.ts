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

@Injectable()
export class VersionsService {
  constructor(
    private readonly repo: DocRepository,
    private readonly extract: LexicalExtractService
  ) {}

  // Replay the update log into a fresh Y.Doc clamped to [0, head].
  private async reconstruct(
    docId: string,
    seq: number,
    head: number
  ): Promise<{ ydoc: Y.Doc; target: number }> {
    const target = Math.max(0, Math.min(seq, head));
    const ydoc = new Y.Doc();
    if (target > 0) {
      const blobs = await this.repo.getDocUpdateBlobsUpTo(docId, target);
      for (const { blob } of blobs) {
        Y.applyUpdate(ydoc, new Uint8Array(blob));
      }
    }
    return { ydoc, target };
  }

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
    const { ydoc, target } = await this.reconstruct(docId, seq, head);
    const yjsState = Y.encodeStateAsUpdate(ydoc);

    // Extract sheet FIRST so the rawTexts getText() loop can't coerce 'rows' to Y.Text; cheap and local, so run it in every mode.
    const sheet = extractSheet(ydoc);

    // 'state' (legacy DOC render, yjs bytes only) and 'text' (SHEET render, reads only `sheet`) skip the CPU-heavy headless-Lexical extraction.
    let lexicalJson: string | null = null;
    let diffJson: string | null = null;
    const rawTexts: Record<string, string> = {};
    let plainText = "";
    if (include === "render") {
      const state = await this.renderState(ydoc);
      lexicalJson = state ? JSON.stringify(state) : null;
      if (state && diffAgainstSeq != null) {
        const base = await this.reconstruct(docId, diffAgainstSeq, head);
        const baseState = await this.renderState(base.ydoc);
        // An empty/failed baseline diffs against the empty doc (everything reads as added).
        diffJson = JSON.stringify(
          diffEditorStates(
            baseState ?? { root: { type: "root", children: [] } },
            state
          )
        );
      }
    } else if (include === "all") {
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

      // Sheets yield empty lexical text, so use a canonical grid serialization; DOC docs keep lexical text.
      plainText = sheet
        ? JSON.stringify({ rows: sheet.rows, colTypes: sheet.colTypes })
        : extracted.plainText;
    }

    // Only 'all' and 'state' callers read the yjs bytes; skip the base64 encode elsewhere.
    const yjsStateB64 =
      include === "text" || include === "render"
        ? ""
        : Buffer.from(yjsState).toString("base64");

    const elapsedMs = Date.now() - t0;
    log.debug(
      `preview '${docId}' seq=${target}/${head} include=${include} json=${lexicalJson?.length ?? 0}B diff=${diffJson?.length ?? 0}B in ${elapsedMs}ms`
    );
    return {
      docId,
      seq: target,
      headSeq: head,
      appliedUpdates: target,
      yjsStateBytes: yjsState.byteLength,
      lexicalJson,
      plainText,
      rawTexts,
      sheet,
      yjsStateB64,
      diffJson,
      elapsedMs,
    };
  }
}
