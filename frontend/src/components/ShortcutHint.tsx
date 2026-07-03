import { Badge } from '@toddle-edu/ds-web';

const styles = {
  keys: 'flex items-center gap-1',
};

type ShortcutHintProps = { keys: string[] };

// Row of square shortcut-key badges (⌘ X style) for tooltips and menu suffixes.
export function ShortcutHint({ keys }: Readonly<ShortcutHintProps>) {
  return (
    <span className={styles.keys}>
      {keys.map((key) => (
        <Badge key={key} dsVersion="2.0" type="shortcut" value={key} shape="square" />
      ))}
    </span>
  );
}
