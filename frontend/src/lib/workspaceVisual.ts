// The backend Workspace model has no icon/color field, so we derive a stable,
// pleasant visual from the workspace id for display (emoji + brand color).
const EMOJIS = ['🚀', '🛠️', '🎨', '📣', '🌱', '📈', '🔬', '📚', '💡', '🧭', '🗂️', '⚡'];

export const BRAND_PALETTE = [
  '#5a5ae2', '#00ac8a', '#ef4371', '#d67d00', '#6d9c00',
  '#00b0c2', '#b646ee', '#e8653a', '#a43dd7', '#f04c54',
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function workspaceVisual(id: string): { icon: string; color: string } {
  const h = hash(id);
  return { icon: EMOJIS[h % EMOJIS.length], color: BRAND_PALETTE[h % BRAND_PALETTE.length] };
}
