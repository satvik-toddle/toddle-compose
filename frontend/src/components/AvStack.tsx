import { Avatar, type AvatarPerson } from './Avatar';

// Overlapping stack of ds-web Avatars + a "+N" overflow.
export function AvStack({
  people,
  size = 24,
  max = 4,
}: {
  people: AvatarPerson[];
  size?: number;
  max?: number;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      {shown.map((p, i) => (
        <span
          key={i}
          style={{
            marginLeft: i === 0 ? 0 : -7,
            borderRadius: '50%',
            boxShadow: '0 0 0 2px var(--panel-bg)',
            display: 'inline-flex',
          }}
        >
          <Avatar person={p} size={size} />
        </span>
      ))}
      {extra > 0 && (
        <span
          style={{
            marginLeft: -7,
            width: size,
            height: size,
            borderRadius: '50%',
            background: 'var(--surface-tertiary-enabled)',
            color: 'var(--text-secondary)',
            fontSize: Math.round(size * 0.36),
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 0 2px var(--panel-bg)',
          }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
