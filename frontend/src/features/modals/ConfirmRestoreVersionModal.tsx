import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, ModalHead } from '../../components/Modal';
import { Button } from '../../components/Button';
import { useDocSnapshot, useRtcToken } from '../../hooks/usePages';
import { qk } from '../../lib/queryKeys';
import { RTC_WS_URL } from '../../lib/env';
import { messageOf } from '../../lib/errors';
import { pushToast } from '../../stores/uiStore';

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
  const { data: snapshot } = useDocSnapshot(docId, seq);
  const { data: rtc } = useRtcToken(docId);
  const [pending, setPending] = useState(false);
  const [, setParams] = useSearchParams();
  const qc = useQueryClient();

  const ready = !!snapshot?.lexicalJson && rtc?.role === 'editor' && !!rtc.token;

  const submit = async () => {
    const editorState = snapshot?.lexicalJson;
    if (pending || !editorState || rtc?.role !== 'editor' || !rtc.token) return;
    setPending(true);
    try {
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
    <Modal onClose={onClose}>
      <ModalHead
        icon="ReloadArrowOutlined"
        title="Restore this version?"
        onClose={onClose}
      />
      <div className="m-body">
        <p className="text-body-s text-secondary">
          The document will be reset to the version from {versionLabel}. Everyone will see the
          restored content. The current content isn't lost — it stays available in version history.
        </p>
      </div>
      <div className="m-foot">
        <span className="gap" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" icon="ReloadArrowOutlined" disabled={pending || !ready} onClick={() => void submit()}>
          {pending ? 'Restoring…' : 'Restore'}
        </Button>
      </div>
    </Modal>
  );
}
