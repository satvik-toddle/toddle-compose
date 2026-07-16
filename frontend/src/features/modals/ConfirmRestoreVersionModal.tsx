import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@toddle-edu/ds-web';
import { ReloadArrowOutlined } from '@toddle-edu/ds-icons';
import { Modal, ModalHead } from '../../components/Modal';
import { useDocSnapshot, useRtcToken } from '../../hooks/usePages';
import { qk } from '../../lib/queryKeys';
import { RTC_WS_URL } from '../../lib/env';
import { messageOf } from '../../lib/errors';
import { pushToast } from '../../stores/uiStore';

type LexicalNode = { uploadId?: unknown; src?: unknown; children?: unknown };

// Clear the preview's baked point-in-time URLs from registry-backed media (restore keeps the upload registry, so live rendering re-resolves src from uploadId).
function stripMaterializedMediaUrls(state: { root?: LexicalNode }): { root?: LexicalNode } {
  const walk = (node: LexicalNode) => {
    if (node.uploadId && node.src) node.src = '';
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  if (state.root) walk(state.root);
  return state;
}

export function ConfirmRestoreVersionModal({
  onClose,
  docId,
  seq,
  versionLabel,
}: {
  onClose: () => void;
  docId: string;
  seq: number;
  versionLabel: string;
}) {
  // No diffAgainst: restore writes the version's own content, never a merged diff state.
  const { data: snapshot, isError: snapError } = useDocSnapshot(docId, seq);
  const { data: rtc, isError: rtcError } = useRtcToken(docId);
  const [pending, setPending] = useState(false);
  const [, setParams] = useSearchParams();
  const qc = useQueryClient();

  const loadError = snapError || rtcError;
  const ready = !!snapshot?.lexicalJson && rtc?.role === 'editor' && !!rtc.token;

  // Block dismissal (Cancel, X, backdrop, Esc) while the async restore is in flight.
  const close = () => {
    if (!pending) onClose();
  };

  const submit = async () => {
    const editorStateJson = snapshot?.lexicalJson;
    if (pending || !editorStateJson || rtc?.role !== 'editor' || !rtc.token) return;
    setPending(true);
    try {
      const editorState = stripMaterializedMediaUrls(JSON.parse(editorStateJson));
      // Lazy import: the editor bundle is ~4MB and ModalRoot mounts at the app root.
      const { restoreCollabDocContent } = await import('@toddle-edu/ds-doc-editor');
      await restoreCollabDocContent({ wsUrl: RTC_WS_URL, docId, token: rtc.token, editorState });
      void qc.invalidateQueries({ queryKey: qk.docHistory(docId) });
      pushToast({ kind: 'success', message: 'Version restored' });
      // Leave history mode so the live editor shows the restored content.
      setParams((prev) => {
        prev.delete('history');
        prev.delete('v');
        prev.delete('diff');
        return prev;
      });
      onClose();
    } catch (e) {
      pushToast({ kind: 'error', message: `Couldn't restore this version: ${messageOf(e)}` });
      setPending(false);
    }
  };

  return (
    <Modal onClose={close}>
      <ModalHead
        icon="ReloadArrowOutlined"
        title="Restore this version?"
        onClose={close}
      />
      <div className="m-body">
        <p className="text-body-s text-secondary">
          The document will be reset to the version from {versionLabel}. Everyone will see the
          restored content. The current content isn't lost — it stays available in version history.
        </p>
        {loadError && (
          <p className="text-body-s text-semantic-error">
            Couldn't load this version. Close and try again.
          </p>
        )}
      </div>
      <div className="m-foot">
        <span className="gap" />
        <Button
          dsVersion="2.0"
          variant="neutral"
          type="plain"
          size="medium"
          disabled={pending}
          onClick={close}
        >
          Cancel
        </Button>
        <Button
          dsVersion="2.0"
          variant="primary"
          type="fill"
          size="medium"
          icon={<ReloadArrowOutlined />}
          disabled={pending || !ready}
          onClick={() => void submit()}
        >
          {pending ? 'Restoring…' : 'Restore'}
        </Button>
      </div>
    </Modal>
  );
}
