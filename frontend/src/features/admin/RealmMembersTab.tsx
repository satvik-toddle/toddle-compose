import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { Avatar } from '../../components/Avatar';
import { RealmChip } from '../../components/RealmChip';
import { RoleSelect } from '../../components/RoleSelect';
import { PageLoader } from '../../components/Loader';
import s from './RealmMembersTab.module.scss';
import { useRealm, useRealmMembers } from '../../hooks/queries';
import { useSetRealmRole } from '../../hooks/useRealmMutations';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { formatDate } from '../../lib/time';
import type { RealmRole } from '../../types/roles';

type AssignableRealmRole = Exclude<RealmRole, 'OWNER'>;
const REALM_OPTIONS: { value: AssignableRealmRole; label: string }[] = [
  { value: 'MAINTAINER', label: 'Maintainer' },
  { value: 'MEMBER', label: 'Member' },
];

export function RealmMembersTab() {
  const me = useAuthStore((s) => s.user);
  const { data: realm } = useRealm();
  const { data: members, isLoading } = useRealmMembers();
  const setRole = useSetRealmRole();
  const openModal = useUiStore((s) => s.openModal);

  const isOwner = realm?.role === 'OWNER';

  if (isLoading) return <div className="page"><div className="page-wrap"><PageLoader /></div></div>;
  const list = members ?? [];

  return (
    <div className="page">
      <div className="page-wrap">
        <div className="page-head">
          <div>
            <h1>Realm members</h1>
            <div className="sub">
              {isOwner
                ? 'As Owner you can manage maintainers and members.'
                : 'As Maintainer you can manage members (not other maintainers).'}
            </div>
          </div>
          <Button variant="primary" icon="AddOutlined" onClick={() => openModal({ type: 'addRealmMember' })}>
            Add member
          </Button>
        </div>

        <div className={`tbl ${s.adMemTbl}`}>
          <div className="thead">
            <div>Person</div>
            <div>Realm role</div>
            <div>Joined</div>
            <div style={{ textAlign: 'right' }}>Actions</div>
          </div>
          {list.map((m) => {
            const isYou = m.userId === me?.id;
            const locked = m.role === 'OWNER';
            const maintainerLockedForMaintainer = m.role === 'MAINTAINER' && !isOwner;
            const editable = !locked && !maintainerLockedForMaintainer;
            return (
              <div key={m.userId} className="trow">
                <div className="cell-main">
                  <Avatar person={{ name: m.user.name, color: m.user.color }} size={32} />
                  <div>
                    <div className="nm">
                      {m.user.name} {isYou && <span className="you-tag">You</span>}
                    </div>
                    <div className="sub">{m.user.email}</div>
                  </div>
                </div>
                <div>
                  <RoleSelect<RealmRole>
                    value={m.role}
                    options={editable ? REALM_OPTIONS : []}
                    locked={!editable}
                    onChange={(role) =>
                      setRole.mutate({ userId: m.userId, role: role as AssignableRealmRole })
                    }
                    renderValue={(r) => <RealmChip role={r} />}
                  />
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>
                  {locked ? 'Owner · seeded' : formatDate(m.createdAt)}
                </div>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                  {locked ? (
                    <span className="lock-note">
                      <Icon name="LockOutlined" size={14} />
                      Owner
                    </span>
                  ) : (
                    <IconButton
                      icon="DeleteOutlined"
                      red
                      title="Remove member"
                      disabled={maintainerLockedForMaintainer}
                      style={maintainerLockedForMaintainer ? { opacity: 0.4 } : undefined}
                      onClick={() =>
                        openModal({
                          type: 'confirmRemoveMember',
                          scope: 'realm',
                          userId: m.userId,
                          name: m.user.name,
                          email: m.user.email,
                        })
                      }
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
