import type { ReactNode } from 'react';
import { useRtcToken } from '../../hooks/usePages';
import { PageLoader } from '../../components/Loader';

const styles = {
  shell: 'flex-1 min-h-0 flex flex-col p-6',
  message: 'flex-1 flex items-center justify-center text-body-s text-secondary',
};

export type RtcSession = {
  token: string;
  canEdit: boolean;
  // Re-mints the token (stores mutate it into the live provider's params).
  refetchToken: () => Promise<unknown>;
};

// Shared RTC-token gate for realtime page editors: error / loader / children(session).
export function RtcGate({
  docId,
  noun,
  children,
}: Readonly<{
  docId: string;
  noun: string;
  children: (session: RtcSession) => ReactNode;
}>) {
  const { data: rtc, isLoading, isError, refetch } = useRtcToken(docId);

  if (isError) {
    return <div className={styles.message}>Couldn&apos;t open this {noun}.</div>;
  }

  if (isLoading || !rtc) {
    return (
      <div className={styles.shell}>
        <PageLoader />
      </div>
    );
  }

  return <>{children({ token: rtc.token, canEdit: rtc.role === 'editor', refetchToken: refetch })}</>;
}
