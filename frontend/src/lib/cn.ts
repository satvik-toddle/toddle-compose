// Tiny classname joiner (replaces the design's `[...].filter(Boolean).join(' ')`).
export type ClassValue = string | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
