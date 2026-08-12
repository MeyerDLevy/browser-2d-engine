export const MAP_SIZE = 1000
export const CHUNK = 64
export const TICK_HZ = 20
export const TICK_DT = 1 / TICK_HZ
export const INTEREST = 48
export const TILE_W = 64
export const TILE_H = 32
export const MAX_Z = 6
// screen N–S span of a tile is TILE_H; equal rise ⇒ visual 45°
export const ROOF_RISE = TILE_H

export const ROOF_SLOPE = 0
export const ROOF_CORNER = 1
// corner quad = which corner is the low (eave) point
export const CORNER_NE = 0
export const CORNER_SE = 1
export const CORNER_SW = 2
export const CORNER_NW = 3

export const NONE = -1
export const GRASS = 0
export const DIRT = 1
export const ROAD = 2
export const WATER = 3
export const WOOD = 4

export const EDGE_NONE = 0
export const EDGE_WALL = 1
export const EDGE_DOOR = 2
export const EDGE_WINDOW = 3

export const DIR_N = 0
export const DIR_E = 1
export const DIR_S = 2
export const DIR_W = 3

export const TILE_COLOR = ['#3d7a3d', '#8b6914', '#5a5a5a', '#3a6ea5', '#9a7a4a']
export const TILE_SIDE = ['#2d5a2d', '#6b5010', '#3e3e3e', '#2a5280', '#6a5030']
export const SOLID_FLOOR = { [WATER]: true }

export type World = {
  seed: number
  mapSize: number
  blank: boolean
  floors: Map<string, number>
  edgesN: Map<string, number>
  edgesW: Map<string, number>
  stairs: Map<string, number>
  roofs: Map<string, number>
  noRoof: Set<string>
}

export type MapData = {
  version?: number
  seed: number
  mapSize: number
  blank?: boolean
  floors: [string, number][]
  edgesN: [string, number][]
  edgesW: [string, number][]
  stairs?: [string, number][]
  roofs: [string, number][] | string[]
  noRoof?: string[]
}

export function makeWorld(seed = 1, mapSize = MAP_SIZE, blank = false): World {
  return {
    seed, mapSize, blank,
    floors: new Map(),
    edgesN: new Map(),
    edgesW: new Map(),
    stairs: new Map(),
    roofs: new Map(),
    noRoof: new Set(),
  }
}

export function hash(x: number, y: number, seed: number) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return (n ^ (n >>> 16)) >>> 0
}

export function tileKey(x: number, y: number) {
  return Math.floor(x) + ',' + Math.floor(y)
}

export function cellKey(x: number, y: number, z = 0) {
  return Math.floor(x) + ',' + Math.floor(y) + ',' + Math.floor(z)
}

function inBuilding(bx: number, by: number) {
  return bx >= 5 && bx <= 15 && by >= 5 && by <= 15
}

export function genFloor(x: number, y: number, seed: number, mapSize: number, blank: boolean) {
  if (x < 0 || y < 0 || x >= mapSize || y >= mapSize) return WATER
  if (blank) return GRASS
  const block = 20
  const bx = x % block
  const by = y % block
  if (bx === 0 || by === 0) return ROAD
  if (inBuilding(bx, by)) return WOOD
  const pond = hash(Math.floor(x / 8), Math.floor(y / 8), seed)
  if (pond % 37 === 0) return WATER
  return GRASS
}

export function getTile(w: World, x: number, y: number, z = 0) {
  const k = cellKey(x, y, z)
  if (w.floors.has(k)) return w.floors.get(k)
  if (z !== 0) return NONE
  return genFloor(Math.floor(x), Math.floor(y), w.seed, w.mapSize, w.blank)
}

export function setTile(w: World, x: number, y: number, t: number, z = 0) {
  w.floors.set(cellKey(x, y, z), t)
}

function genEdgeN(x: number, y: number, seed: number, mapSize: number, blank: boolean) {
  if (blank || x < 0 || y < 0 || x >= mapSize || y >= mapSize) return EDGE_NONE
  const block = 20
  const bx = x % block
  const by = y % block
  if (bx >= 5 && bx <= 15 && by === 5) {
    if (bx === 8 || bx === 12) return EDGE_WINDOW
    return EDGE_WALL
  }
  if (bx >= 5 && bx <= 15 && by === 16) {
    if (bx === 10) return EDGE_DOOR
    if (bx === 7 || bx === 13) return EDGE_WINDOW
    return EDGE_WALL
  }
  return EDGE_NONE
}

function genEdgeW(x: number, y: number, seed: number, mapSize: number, blank: boolean) {
  if (blank || x < 0 || y < 0 || x >= mapSize || y >= mapSize) return EDGE_NONE
  const block = 20
  const bx = x % block
  const by = y % block
  if (by >= 5 && by <= 15 && bx === 5) {
    if (by === 8 || by === 12) return EDGE_WINDOW
    return EDGE_WALL
  }
  if (by >= 5 && by <= 15 && bx === 16) {
    if (by === 8 || by === 12) return EDGE_WINDOW
    return EDGE_WALL
  }
  return EDGE_NONE
}

export function edgeN(w: World, x: number, y: number, z = 0) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const k = cellKey(ix, iy, z)
  if (w.edgesN.has(k)) return w.edgesN.get(k)
  if (z !== 0) return EDGE_NONE
  return genEdgeN(ix, iy, w.seed, w.mapSize, w.blank)
}

export function edgeW(w: World, x: number, y: number, z = 0) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const k = cellKey(ix, iy, z)
  if (w.edgesW.has(k)) return w.edgesW.get(k)
  if (z !== 0) return EDGE_NONE
  return genEdgeW(ix, iy, w.seed, w.mapSize, w.blank)
}

export function setEdgeN(w: World, x: number, y: number, e: number, z = 0) {
  w.edgesN.set(cellKey(x, y, z), e)
}

export function setEdgeW(w: World, x: number, y: number, e: number, z = 0) {
  w.edgesW.set(cellKey(x, y, z), e)
}

export function getStairs(w: World, x: number, y: number, z = 0) {
  const k = cellKey(x, y, z)
  if (!w.stairs.has(k)) return null
  return w.stairs.get(k)
}

export function setStairs(w: World, x: number, y: number, dir: number, z = 0) {
  w.stairs.set(cellKey(x, y, z), dir)
}

export function clearStairs(w: World, x: number, y: number, z = 0) {
  w.stairs.delete(cellKey(x, y, z))
}

// roof value: -1 = flat
// slope:  kind0 * 1024 + dir * 256 + step  (legacy dir*256+step still unpacks as slope)
// corner: kind1 * 1024 + quad * 256 + step
export function packRoof(dir: number, step: number, kind = ROOF_SLOPE) {
  if (step < 0) return -1
  return (kind & 3) * 1024 + (dir & 3) * 256 + (step & 255)
}

export function packRoofCorner(quad: number, step: number) {
  return packRoof(quad, step, ROOF_CORNER)
}

export function unpackRoof(v: number) {
  if (v < 0) return { kind: ROOF_SLOPE, dir: 0, step: -1, flat: true, corner: false }
  const kind = Math.floor(v / 1024) & 3
  const dir = Math.floor((v % 1024) / 256) & 3
  const step = v & 255
  return { kind, dir, step, flat: false, corner: kind === ROOF_CORNER }
}

function roofEntry(w: World, x: number, y: number, z: number) {
  const k = cellKey(x, y, z)
  if (w.noRoof.has(k) || !w.roofs.has(k)) return null
  return unpackRoof(w.roofs.get(k))
}

/** After painting slopes, fill outer hip corners where perpendicular slopes meet. */
export function resolveRoofCorners(w: World, z: number) {
  const candidates = new Set<string>()
  for (const [k, v] of w.roofs) {
    const parts = k.split(',')
    if (+parts[2] !== z) continue
    const u = unpackRoof(v)
    if (u.flat || u.corner) continue
    const x = +parts[0], y = +parts[1]
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      candidates.add(cellKey(x + dx, y + dy, z))
    }
  }
  // drop old corners on this level so we can rebuild
  for (const k of [...w.roofs.keys()]) {
    const parts = k.split(',')
    if (+parts[2] !== z) continue
    if (unpackRoof(w.roofs.get(k)).corner) w.roofs.delete(k)
  }
  for (const k of candidates) {
    const parts = k.split(',')
    const x = +parts[0], y = +parts[1]
    const E = roofEntry(w, x + 1, y, z)
    const W = roofEntry(w, x - 1, y, z)
    const N = roofEntry(w, x, y - 1, z)
    const S = roofEntry(w, x, y + 1, z)
    const slope = (r: ReturnType<typeof unpackRoof>, dir: number) =>
      r && !r.flat && !r.corner && r.dir === dir ? r : null
    let quad = -1, step = 0
    // outer hips: low corner points outward
    if (slope(E, DIR_S) && slope(N, DIR_W)) { quad = CORNER_SW; step = Math.min(E.step, N.step) }
    else if (slope(W, DIR_S) && slope(N, DIR_E)) { quad = CORNER_SE; step = Math.min(W.step, N.step) }
    else if (slope(E, DIR_N) && slope(S, DIR_W)) { quad = CORNER_NW; step = Math.min(E.step, S.step) }
    else if (slope(W, DIR_N) && slope(S, DIR_E)) { quad = CORNER_NE; step = Math.min(W.step, S.step) }
    if (quad < 0) continue
    w.roofs.set(k, packRoofCorner(quad, step))
    w.noRoof.delete(k)
  }
}

export function getRoof(w: World, x: number, y: number, z = 0) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const k = cellKey(ix, iy, z)
  if (w.noRoof.has(k)) return null
  if (w.roofs.has(k)) return unpackRoof(w.roofs.get(k))
  if (z !== 0 || w.blank) return null
  const block = 20
  const bx = ix % block, by = iy % block
  if (inBuilding(bx, by)) return { kind: ROOF_SLOPE, dir: 0, step: -1, flat: true, corner: false }
  return null
}

export function hasRoof(w: World, x: number, y: number, z = 0) {
  return !!getRoof(w, x, y, z)
}

export function setRoof(w: World, x: number, y: number, on: boolean, z = 0, packed = -1) {
  const k = cellKey(x, y, z)
  if (on) {
    w.roofs.set(k, packed)
    w.noRoof.delete(k)
  } else {
    w.roofs.delete(k)
    w.noRoof.add(k)
  }
}

export function isSolid(w: World, x: number, y: number, z = 0) {
  if (x < 0 || y < 0 || x >= w.mapSize || y >= w.mapSize) return true
  const t = getTile(w, x, y, z)
  if (t === NONE) return true
  return !!SOLID_FLOOR[t]
}

export function hasFloor(w: World, x: number, y: number, z = 0) {
  return getTile(w, x, y, z) !== NONE
}

export function edgeBlocks(e: number) {
  return e === EDGE_WALL || e === EDGE_WINDOW
}

export function edgeOpaque(e: number) {
  return e === EDGE_WALL
}

export function dirDelta(dir: number) {
  if (dir === DIR_N) return { dx: 0, dy: -1 }
  if (dir === DIR_E) return { dx: 1, dy: 0 }
  if (dir === DIR_S) return { dx: 0, dy: 1 }
  return { dx: -1, dy: 0 }
}

function migrateKey(k: string) {
  if (k.split(',').length === 3) return k
  return k + ',0'
}

export function serializeMap(w: World): MapData {
  return {
    version: 2,
    seed: w.seed,
    mapSize: w.mapSize,
    blank: w.blank,
    floors: [...w.floors.entries()],
    edgesN: [...w.edgesN.entries()],
    edgesW: [...w.edgesW.entries()],
    stairs: [...w.stairs.entries()],
    roofs: [...w.roofs.entries()],
    noRoof: [...w.noRoof],
  }
}

export function applyMap(w: World, data: MapData) {
  w.seed = data.seed
  w.mapSize = data.mapSize
  w.blank = !!data.blank
  const v = data.version || 1
  if (v < 2) {
    w.floors = new Map((data.floors || []).map(([k, v]) => [migrateKey(k), v]))
    w.edgesN = new Map((data.edgesN || []).map(([k, v]) => [migrateKey(k), v]))
    w.edgesW = new Map((data.edgesW || []).map(([k, v]) => [migrateKey(k), v]))
    w.stairs = new Map()
    const roofs = data.roofs || []
    if (roofs.length && typeof roofs[0] === 'string') {
      w.roofs = new Map((roofs as string[]).map(k => [migrateKey(k), -1]))
    } else {
      w.roofs = new Map((roofs as [string, number][]).map(([k, v]) => [migrateKey(k), v]))
    }
    w.noRoof = new Set((data.noRoof || []).map(migrateKey))
  } else {
    w.floors = new Map(data.floors || [])
    w.edgesN = new Map(data.edgesN || [])
    w.edgesW = new Map(data.edgesW || [])
    w.stairs = new Map(data.stairs || [])
    w.roofs = new Map((data.roofs as [string, number][]) || [])
    w.noRoof = new Set(data.noRoof || [])
  }
}

export function worldFromMap(data: MapData): World {
  const w = makeWorld(data.seed, data.mapSize, !!data.blank)
  applyMap(w, data)
  return w
}

export function chunkKey(x: number, y: number) {
  return Math.floor(x / CHUNK) + ',' + Math.floor(y / CHUNK)
}

export function iso(tx: number, ty: number) {
  return {
    x: (tx - ty) * (TILE_W / 2),
    y: (tx + ty) * (TILE_H / 2),
  }
}

export function screenToTile(sx: number, sy: number) {
  return {
    x: sx / TILE_W + sy / TILE_H,
    y: sy / TILE_H - sx / TILE_W,
  }
}
