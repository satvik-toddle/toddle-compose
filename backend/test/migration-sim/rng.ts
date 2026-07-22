// Deterministic, seedable RNG (mulberry32) so any failing scenario is fully
// reproducible from its integer seed alone — print the seed, re-run that seed.
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Avoid a zero state (mulberry32 degenerates); mix the seed a little.
    this.state = (seed ^ 0x9e3779b9) >>> 0;
  }

  // Next float in [0, 1).
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Integer in [min, max] inclusive.
  int(min: number, max: number): number {
    if (max < min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }

  // True with probability p.
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }

  // Fisher–Yates shuffle (in place), returns the same array.
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}
