import { edgeN, edgeOpaque, edgeW, tileKey, type World } from '../shared/world.ts'

const R = 26
let cacheKey = ''
let cache = new Set<string>()

function walkRay(w: World, z: number, x0: number, y0: number, x1: number, y1: number, vis: Set<string>) {
  let x = x0
  let y = y0
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  vis.add(tileKey(x, y))
  while (x !== x1 || y !== y1) {
    const e2 = err * 2
    const stepX = e2 > -dy
    const stepY = e2 < dx
    if (stepX && stepY) {
      const nx = x + sx
      const ny = y + sy
      const blockH = edgeOpaque(edgeW(w, Math.max(x, nx), y, z)) || edgeOpaque(edgeN(w, nx, Math.max(y, ny), z))
      const blockV = edgeOpaque(edgeN(w, x, Math.max(y, ny), z)) || edgeOpaque(edgeW(w, Math.max(x, nx), ny, z))
      if (blockH || blockV) {
        if (edgeOpaque(edgeW(w, Math.max(x, nx), y, z))) vis.add(tileKey(nx, y))
        if (edgeOpaque(edgeN(w, x, Math.max(y, ny), z))) vis.add(tileKey(x, ny))
        return
      }
      err -= dy
      err += dx
      x = nx
      y = ny
    } else if (stepX) {
      err -= dy
      const nx = x + sx
      if (edgeOpaque(edgeW(w, Math.max(x, nx), y, z))) {
        vis.add(tileKey(nx, y))
        return
      }
      x = nx
    } else if (stepY) {
      err += dx
      const ny = y + sy
      if (edgeOpaque(edgeN(w, x, Math.max(y, ny), z))) {
        vis.add(tileKey(x, ny))
        return
      }
      y = ny
    }
    vis.add(tileKey(x, y))
  }
}

export function visibleTiles(w: World, px: number, py: number, pz = 0) {
  const x = Math.floor(px)
  const y = Math.floor(py)
  const z = Math.floor(pz)
  const k = w.seed + ':' + w.mapSize + ':' + w.blank + ':' + z + ':' +
    w.floors.size + ':' + w.edgesN.size + ':' + w.edgesW.size + ':' +
    w.roofs.size + ':' + w.noRoof.size + ':' + w.stairs.size + ':' + x + ',' + y
  if (k === cacheKey) return cache
  const vis = new Set<string>()
  for (let d = -R; d <= R; d++) {
    walkRay(w, z, x, y, x + d, y - R, vis)
    walkRay(w, z, x, y, x + d, y + R, vis)
  }
  for (let d = -R + 1; d <= R - 1; d++) {
    walkRay(w, z, x, y, x - R, y + d, vis)
    walkRay(w, z, x, y, x + R, y + d, vis)
  }
  cacheKey = k
  cache = vis
  return vis
}

export function clearVisionCache() {
  cacheKey = ''
}
