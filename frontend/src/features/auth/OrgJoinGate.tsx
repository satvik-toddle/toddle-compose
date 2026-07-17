import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@toddle-edu/ds-web';
import { BellRingOutlined, SendOutlined } from '@toddle-edu/ds-icons';
import { AuthShell } from './AuthShell';
import { useRealm, useMyOrgRequest } from '../../hooks/queries';
import { useRequestJoinOrg } from '../../hooks/useOrgJoinRequestMutations';
import { useAuthStore } from '../../stores/authStore';
import { performLogout } from '../../lib/session';
import { qk } from '../../lib/queryKeys';

const styles = {
  iconBadge:
    'mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-tertiary-enabled [&_.ic]:opacity-70',
  heading: 'text-heading-3 text-primary',
  body: 'mt-1.5 mb-5 text-body text-secondary',
  action: 'flex justify-center',
  signedInEmail: 'font-semibold text-primary',
};

// Gate shown to a signed-in non-member while org join-requests are enabled: they
// request to join and wait for admin approval instead of reaching the app.
export function OrgJoinGate() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const { data: realm } = useRealm();
  const { data: myOrgRequest } = useMyOrgRequest();
  const requestJoinOrg = useRequestJoinOrg();

  const orgName = realm?.name ?? 'this organisation';
  const isPending = myOrgRequest?.state === 'PENDING';
  const isRejected = myOrgRequest?.state === 'REJECTED';

  // Approval promotes the caller to a realm member; refresh so the membership gate lets them through.
  useEffect(() => {
    if (myOrgRequest?.state !== 'APPROVED') return;
    queryClient.invalidateQueries({ queryKey: qk.realm });
    queryClient.invalidateQueries({ queryKey: qk.workspaces });
    navigate('/launcher', { replace: true });
  }, [myOrgRequest?.state, queryClient, navigate]);

  const signOut = async () => {
    await performLogout(queryClient);
    navigate('/login');
  };

  return (
    <AuthShell
      foot={
        <>
          {currentUser && (
            <span>
              Signed in as <b className={styles.signedInEmail}>{currentUser.email}</b> ·
            </span>
          )}
          <Button variant="progressive" type="inline" size="small" onClick={signOut}>
            Sign out
          </Button>
        </>
      }
    >
      {isPending ? (
        <>
          <div className={styles.iconBadge}>
            <BellRingOutlined className="ic" />
          </div>
          <h1 className={styles.heading}>Authorization pending</h1>
          <p className={styles.body}>
            Your request to join {orgName} is awaiting an admin’s approval. You’ll get in
            automatically once it’s approved.
          </p>
          <div className={styles.action}>
            <Button variant="neutral" type="outlined" size="medium" disabled icon={<BellRingOutlined />}>
              Awaiting approval
            </Button>
          </div>
        </>
      ) : (
        <>
          <h1 className={styles.heading}>Request to join {orgName}</h1>
          <p className={styles.body}>
            {isRejected
              ? 'Your previous request was declined — you can ask again.'
              : 'Your account isn’t part of this organisation yet. Send a request and an admin will add you as a member.'}
          </p>
          <div className={styles.action}>
            <Button
              variant="primary"
              type="fill"
              size="medium"
              icon={<SendOutlined />}
              disabled={requestJoinOrg.isPending}
              onClick={() => requestJoinOrg.mutate()}
            >
              {isRejected ? 'Request again' : 'Request to join'}
            </Button>
          </div>
        </>
      )}
    </AuthShell>
  );
}
