export const MAP_SIZE = 1000
export const CHUNK = 64
export const TICK_HZ = 20
export const TICK_DT = 1 / TICK_HZ
export const INTEREST = 48
export const TILE_W = 64
export const TILE_H = 32

export const GRASS = 0
export const DIRT = 1
export const ROAD = 2
export const WATER = 3
export const WOOD = 4

export const EDGE_NONE = 0
export const EDGE_WALL = 1
export const EDGE_DOOR = 2
export const EDGE_WINDOW = 3

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
  roofs: Set<string>
  noRoof: Set<string>
}

export type MapData = {
  seed: number
  mapSize: number
  blank?: boolean
  floors: [string, number][]
  edgesN: [string, number][]
  edgesW: [string, number][]
  roofs: string[]
  noRoof?: string[]
}

export function makeWorld(seed = 1, mapSize = MAP_SIZE, blank = false): World {
  return {
    seed, mapSize, blank,
    floors: new Map(),
    edgesN: new Map(),
    edgesW: new Map(),
    roofs: new Set(),
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

export function getTile(w: World, x: number, y: number) {
  const k = tileKey(x, y)
  if (w.floors.has(k)) return w.floors.get(k)
  return genFloor(Math.floor(x), Math.floor(y), w.seed, w.mapSize, w.blank)
}

export function setTile(w: World, x: number, y: number, t: number) {
  w.floors.set(tileKey(x, y), t)
}

function genEdgeN(x: number, y: number, seed: number, mapSize: number, blank: boolean) {
  if (blank || x < 0 || y < 0 || x >= mapSize || y >= mapSize) return EDGE_NONE
  const block = 20
  const bx = x % block
  const by = y % block
  // north wall of building (by == 5): edgeN of tiles by=5
  if (bx >= 5 && bx <= 15 && by === 5) {
    if (bx === 8 || bx === 12) return EDGE_WINDOW
    return EDGE_WALL
  }
  // south wall of building (by == 15): edgeN of tiles by=16
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
  // west wall (bx == 5)
  if (by >= 5 && by <= 15 && bx === 5) {
    if (by === 8 || by === 12) return EDGE_WINDOW
    return EDGE_WALL
  }
  // east wall (bx == 15): edgeW of tiles bx=16
  if (by >= 5 && by <= 15 && bx === 16) {
    if (by === 8 || by === 12) return EDGE_WINDOW
    return EDGE_WALL
  }
  return EDGE_NONE
}

export function edgeN(w: World, x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const k = tileKey(ix, iy)
  if (w.edgesN.has(k)) return w.edgesN.get(k)
  return genEdgeN(ix, iy, w.seed, w.mapSize, w.blank)
}

export function edgeW(w: World, x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const k = tileKey(ix, iy)
  if (w.edgesW.has(k)) return w.edgesW.get(k)
  return genEdgeW(ix, iy, w.seed, w.mapSize, w.blank)
}

export function setEdgeN(w: World, x: number, y: number, e: number) {
  w.edgesN.set(tileKey(x, y), e)
}

export function setEdgeW(w: World, x: number, y: number, e: number) {
  w.edgesW.set(tileKey(x, y), e)
}

export function hasRoof(w: World, x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const k = tileKey(ix, iy)
  if (w.noRoof.has(k)) return false
  if (w.roofs.has(k)) return true
  if (w.blank) return false
  const block = 20
  const bx = ix % block, by = iy % block
  return inBuilding(bx, by)
}

export function setRoof(w: World, x: number, y: number, on: boolean) {
  const k = tileKey(x, y)
  if (on) {
    w.roofs.add(k)
    w.noRoof.delete(k)
  } else {
    w.roofs.delete(k)
    w.noRoof.add(k)
  }
}

export function isSolid(w: World, x: number, y: number) {
  if (x < 0 || y < 0 || x >= w.mapSize || y >= w.mapSize) return true
  return !!SOLID_FLOOR[getTile(w, x, y)]
}

export function edgeBlocks(e: number) {
  return e === EDGE_WALL || e === EDGE_WINDOW
}

export function edgeOpaque(e: number) {
  return e === EDGE_WALL
}

export function serializeMap(w: World): MapData {
  return {
    seed: w.seed,
    mapSize: w.mapSize,
    blank: w.blank,
    floors: [...w.floors.entries()],
    edgesN: [...w.edgesN.entries()],
    edgesW: [...w.edgesW.entries()],
    roofs: [...w.roofs],
    noRoof: [...w.noRoof],
  }
}

export function applyMap(w: World, data: MapData) {
  w.seed = data.seed
  w.mapSize = data.mapSize
  w.blank = !!data.blank
  w.floors = new Map(data.floors || [])
  w.edgesN = new Map(data.edgesN || [])
  w.edgesW = new Map(data.edgesW || [])
  w.roofs = new Set(data.roofs || [])
  w.noRoof = new Set(data.noRoof || [])
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
