import { EDGE_DOOR, ROAD, DIRT, WOOD, GRASS, edgeBlocks, edgeN, edgeW, getTile, isSolid, objectBlocks } from '../world.ts'
import type { World } from '../world.ts'
import type { Vec } from './types.ts'

const WEIGHT_ROAD = 1
const WEIGHT_DIRT = 1.2
const WEIGHT_GRASS = 6
const WEIGHT_INTERIOR = 1.5

function walkable(w: World, x: number, y: number, z = 0) {
  if (isSolid(w, x, y, z) || objectBlocks(w, x, y, z)) return false
  return true
}

function blockedEdge(w: World, x0: number, y0: number, x1: number, y1: number, z: number) {
  if (x1 !== x0 && y1 !== y0) {
    return blockedEdge(w, x0, y0, x1, y0, z) || blockedEdge(w, x0, y0, x0, y1, z)
  }
  if (x1 > x0) return edgeBlocks(edgeW(w, x1, y0, z))
  if (x1 < x0) return edgeBlocks(edgeW(w, x0, y0, z))
  if (y1 > y0) return edgeBlocks(edgeN(w, x0, y1, z))
  if (y1 < y0) return edgeBlocks(edgeN(w, x0, y0, z))
  return false
}

function weight(w: World, x: number, y: number, z: number) {
  const t = getTile(w, x, y, z)
  if (t === ROAD) return WEIGHT_ROAD
  if (t === DIRT) return WEIGHT_DIRT
  if (t === WOOD) return WEIGHT_INTERIOR
  if (t === GRASS) return WEIGHT_GRASS
  return 3
}

function key(x: number, y: number) {
  return x + ',' + y
}

export function findPath(w: World, from: Vec, to: Vec, z = 0): Vec[] {
  const sx = Math.floor(from.x), sy = Math.floor(from.y)
  const gx = Math.floor(to.x), gy = Math.floor(to.y)
  if (sx === gx && sy === gy) return [{ x: to.x, y: to.y, z }]
  const open: { x: number; y: number; g: number; f: number }[] = [{ x: sx, y: sy, g: 0, f: 0 }]
  const came = new Map<string, string>()
  const gScore = new Map<string, number>([[key(sx, sy), 0]])
  const closed = new Set<string>()
  let guard = 0
  while (open.length && guard++ < 8000) {
    let bi = 0
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i
    const cur = open.splice(bi, 1)[0]
    const ck = key(cur.x, cur.y)
    if (closed.has(ck)) continue
    closed.add(ck)
    if (cur.x === gx && cur.y === gy) {
      const pts: Vec[] = [{ x: to.x, y: to.y, z }]
      let k = ck
      while (came.has(k)) {
        k = came.get(k)
        const [x, y] = k.split(',').map(Number)
        pts.push({ x: x + 0.5, y: y + 0.5, z })
      }
      pts.reverse()
      return pts
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = cur.x + dx, ny = cur.y + dy
        if (!walkable(w, nx, ny, z)) continue
        if (blockedEdge(w, cur.x, cur.y, nx, ny, z)) continue
        if (dx && dy) {
          if (!walkable(w, cur.x + dx, cur.y, z) || !walkable(w, cur.x, cur.y + dy, z)) continue
          if (blockedEdge(w, cur.x, cur.y, cur.x + dx, cur.y, z) || blockedEdge(w, cur.x, cur.y, cur.x, cur.y + dy, z)) continue
        }
        const nk = key(nx, ny)
        const step = (dx && dy ? 1.414 : 1) * weight(w, nx, ny, z)
        const g = cur.g + step
        if (g >= (gScore.get(nk) ?? Infinity)) continue
        came.set(nk, ck)
        gScore.set(nk, g)
        const h = Math.hypot(nx - gx, ny - gy)
        open.push({ x: nx, y: ny, g, f: g + h })
      }
    }
  }
  return []
}

export function doorPassable(_w: World, _x: number, _y: number, _z: number) {
  return true
}

void EDGE_DOOR
