import { Avatar } from './Avatar';
import { tableStyles as t } from './tableStyles';

// Avatar + name (+ optional "You" tag) + email — the shared person cell used by
// every members/requests table.
export function PersonCell({
  name,
  email,
  color,
  youTag,
}: {
  name: string;
  email: string;
  color?: string;
  youTag?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.75">
      <Avatar person={{ name, color }} size={32} />
      <div className="min-w-0">
        <div className={t.nm}>
          {name} {youTag && <span className={t.youTag}>You</span>}
        </div>
        <div className={t.rowSub}>{email}</div>
      </div>
    </div>
  );
}
