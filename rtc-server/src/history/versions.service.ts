import { Injectable } from "@nestjs/common";
import * as Y from "yjs";
import { DocRepository } from "../persistence/doc-repository.service";
import { LexicalExtractService } from "../persistence/lexical-extract.service";
import {
  SheetSnapshot,
  extractSheet,
} from "../persistence/searchable-text";
import { createLogger } from "../logger";

const log = createLogger("versions");

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
  elapsedMs: number;
};

@Injectable()
export class VersionsService {
  constructor(
    private readonly repo: DocRepository,
    private readonly extract: LexicalExtractService
  ) {}

  async previewAtSeq(docId: string, seq: number): Promise<VersionPreview> {
    const t0 = Date.now();
    const head = await this.repo.getHeadSeq(docId);
    const target = Math.max(0, Math.min(seq, head));
    const ydoc = new Y.Doc();
    if (target > 0) {
      const blobs = await this.repo.getDocUpdateBlobsUpTo(docId, target);
      for (const { blob } of blobs) {
        Y.applyUpdate(ydoc, new Uint8Array(blob));
      }
    }
    const yjsState = Y.encodeStateAsUpdate(ydoc);

    // Extract sheet FIRST to fix 'rows'/'colTypes' to concrete Array/Map types: the rawTexts getText() loop below would otherwise coerce 'rows' to Y.Text and break later typed reads.
    const sheet = extractSheet(ydoc);

    const { lexicalJson, plainText: lexicalText } =
      await this.extract.extractFromBytes(yjsState);

    const rawTexts: Record<string, string> = {};
    for (const key of ydoc.share.keys()) {
      try {
        const s = ydoc.getText(key).toString();
        if (s.length > 0) rawTexts[key] = s;
      } catch {
        /* not text-coercible (e.g. the sheet's Array/Map roots) */
      }
    }

    // Sheets yield empty lexical text (every session would look like a no-op), so use a canonical grid serialization; DOC docs keep lexical text.
    const plainText = sheet
      ? JSON.stringify({ rows: sheet.rows, colTypes: sheet.colTypes })
      : lexicalText;

    const elapsedMs = Date.now() - t0;
    log.debug(
      `preview '${docId}' seq=${target}/${head} json=${lexicalJson?.length ?? 0}B in ${elapsedMs}ms`
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
      elapsedMs,
    };
  }
}
