import { Injectable } from "@nestjs/common";
import * as Y from "yjs";
import { DocRepository } from "../persistence/doc-repository.service";
import { LexicalExtractService } from "../persistence/lexical-extract.service";
import {
  SheetSnapshot,
  extractSheet,
} from "../persistence/searchable-text";
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

// Which slice the caller reads, so we skip the rest (see previewAtSeq): 'all' = everything; 'state' = yjs bytes only (legacy DOC render); 'render' = materialized lexicalJson (+ optional diffJson) only (DOC render); 'text' = sheet snapshot only (SHEET render).
export type PreviewInclude = "all" | "state" | "render" | "text";

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

    // Extract sheet BEFORE the rawTexts getText() loop so it can't coerce 'rows' to Y.Text; cheap and local, so run it in every mode.
    const sheet = extractSheet(ydoc);

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

      // Sheets yield empty lexical text, so use a canonical grid serialization; DOC docs keep lexical text.
      plainText = sheet
        ? JSON.stringify({ rows: sheet.rows, colTypes: sheet.colTypes })
        : extracted.plainText;
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
      yjsStateB64,
      diffJson,
      elapsedMs,
    };
  }
}
