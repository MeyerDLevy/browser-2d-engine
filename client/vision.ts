import { isOpaque, tileKey, type World } from '../shared/world.ts'

const R = 26
let cacheKey = ''
let cache = new Set<string>()

function walkRay(w: World, x0: number, y0: number, x1: number, y1: number, vis: Set<string>) {
  const dx = x1 - x0
  const dy = y1 - y0
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 3))
  let last = ''
  for (let i = 0; i <= steps; i++) {
    const gx = Math.floor(x0 + 0.5 + dx * i / steps)
    const gy = Math.floor(y0 + 0.5 + dy * i / steps)
    const k = gx + ',' + gy
    if (k === last) continue
    last = k
    vis.add(k)
    if (i > 0 && isOpaque(w, gx, gy)) return
  }
}

export function visibleTiles(w: World, px: number, py: number) {
  const x = Math.floor(px)
  const y = Math.floor(py)
  const k = w.seed + ':' + w.mapSize + ':' + x + ',' + y
  if (k === cacheKey) return cache
  const vis = new Set<string>()
  vis.add(tileKey(x, y))
  for (let d = -R; d <= R; d++) {
    walkRay(w, x, y, x + d, y - R, vis)
    walkRay(w, x, y, x + d, y + R, vis)
  }
  for (let d = -R + 1; d <= R - 1; d++) {
    walkRay(w, x, y, x - R, y + d, vis)
    walkRay(w, x, y, x + R, y + d, vis)
  }
  cacheKey = k
  cache = vis
  return vis
}
