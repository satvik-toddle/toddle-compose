import type { IconName } from '../components/iconMap';

// The backend Workspace model has no icon/color field, so we derive a stable,
// pleasant visual from the workspace id for display (ds-icon + brand color).
// Curated workspace identity icons — also drives the create/rename icon picker.
export const WORKSPACE_ICONS: IconName[] = [
  'DashboardOutlined',
  'GridOutlined',
  'FolderOutlined',
  'BoltOutlined',
  'StarOutlined',
  'GlobeOutlined',
  'MultipleUsersOutlined',
  'HomeOutlined',
  'ShareOutlined',
  'BellRingOutlined',
  'ImageSquareOutlined',
  'SettingsOutlined',
];

// A DS decorative/tag hue name. Consumers build the flipping semantic tokens
// --tag-background-{hue}-default (chip fill) and --tag-foreground-{hue} (icon) from
// it, so the workspace chip themes itself in both light and dark.
export type WorkspaceHue =
  | 'violet' | 'teal' | 'pink' | 'yellow' | 'green'
  | 'blue' | 'purple' | 'orange' | 'red';

// One hue per slot; mirrors the id→hue mapping in dsAvatar.ts (COLOR_BY_HEX) so a
// workspace keeps the same identity color it had under the old BRAND_PALETTE.
const HUE_PALETTE: WorkspaceHue[] = [
  'violet', 'teal', 'pink', 'yellow', 'green',
  'blue', 'purple', 'orange', 'purple', 'red',
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function workspaceVisual(id: string): { icon: IconName; hue: WorkspaceHue } {
  const h = hash(id);
  return {
    icon: WORKSPACE_ICONS[h % WORKSPACE_ICONS.length],
    hue: HUE_PALETTE[h % HUE_PALETTE.length],
  };
}
