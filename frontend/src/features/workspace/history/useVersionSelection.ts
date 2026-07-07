import { useDocHistory } from '../../../hooks/usePages';
import { useHistoryMode } from './useHistoryMode';

// Single source of the "which version is showing" rule, shared by the versions list
// (VersionsSection) and the snapshot pane (DocHistoryView) so they can never disagree:
//   effectiveSeq = the ?v seq, else the newest session's lastSeq
//   session      = the session whose lastSeq === effectiveSeq, else undefined
//                  (undefined when ?v names a seq no session matches).
export function useVersionSelection(docId: string) {
  const { selectedSeq } = useHistoryMode();
  const { data, isLoading, isError } = useDocHistory(docId);

  const sessions = data?.sessions ?? [];
  const effectiveSeq = selectedSeq ?? sessions[0]?.lastSeq ?? null;
  const session =
    effectiveSeq != null ? sessions.find((s) => s.lastSeq === effectiveSeq) : undefined;

  return { sessions, isLoading, isError, effectiveSeq, session };
}
