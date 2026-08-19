export type Rng = {
  seed: number
  rand(): number
  randf(): number
  randfRange(lo: number, hi: number): number
  randi(n: number): number
  randfn(mean?: number, sd?: number): number
  chance(p: number): boolean
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0 || 1
  function rand() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  return {
    get seed() { return s },
    set seed(v) { s = v >>> 0 || 1 },
    rand,
    randf: rand,
    randfRange(lo, hi) { return lo + rand() * (hi - lo) },
    randi(n) { return Math.floor(rand() * n) },
    randfn(mean = 0, sd = 1) {
      let u = 0, v = 0
      while (u === 0) u = rand()
      while (v === 0) v = rand()
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    },
    chance(p) { return rand() < p },
  }
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}
