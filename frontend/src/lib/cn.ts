// Classname joiner with Tailwind conflict resolution. clsx handles conditional
// inputs (strings, arrays, objects, falsy values); tailwind-merge dedupes
// conflicting utilities so a caller's `px-6` wins over a component's `px-4`
// instead of both landing in the class list.
//
// tailwind-merge ships only Tailwind's *default* scale. Most of our DS custom-scale
// classes (gap-120, leading-200, font-weight-600, shadow-elevation-*, …) happen to
// dedupe correctly on the default rules, but two families do NOT and must be taught
// the DS scale — otherwise cn() silently misbehaves:
//   • `text-size-*` (our font-size utilities): by default twMerge mistakes them for
//     text-*COLOR* utilities and DROPS a co-applied color — cn('text-size-400',
//     'text-primary') would return just 'text-primary'. Registering them under the
//     font-size group keeps both (they set different CSS properties).
//   • numeric `rounded-*` (rounded-2, rounded-t-3, …): not in the default radius
//     scale, so two of them both survive and CSS source-order — not the caller —
//     decides the winner. Feeding the radii into the `radius` theme fixes every
//     rounded-* group (base + per-corner) at once.
// The value sets below mirror frontend/tailwind.config.js (fontSize keys `size-*`,
// borderRadius numeric keys); keep them in sync if that scale changes.
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

export type { ClassValue };

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: [{ size: ['25', '50', '75', '100', '200', '300', '400', '500', '600', '700', '800'] }] },
      ],
    },
    theme: {
      radius: ['0', '0.5', '0.625', '0.75', '1', '1.5', '2', '2.5', '3', '4'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
