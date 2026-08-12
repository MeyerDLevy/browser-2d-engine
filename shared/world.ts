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
export const WALL = 4
export const DOOR = 5
export const WINDOW = 6

export const TILE_COLOR = ['#3d7a3d', '#8b6914', '#5a5a5a', '#3a6ea5', '#6b5344', '#5c3a22', '#8ab4c8']
export const TILE_SIDE = ['#2d5a2d', '#6b5010', '#3e3e3e', '#2a5280', '#4a3a30', '#3a2414', '#4a6a78']
export const SOLID = { [WATER]: true, [WALL]: true, [WINDOW]: true }
export const OPAQUE = { [WALL]: true }
export const TALL = { [WALL]: true, [WINDOW]: true }

export type World = {
  seed: number
  mapSize: number
  overrides: Map<string, number>
}

export function makeWorld(seed = 1, mapSize = MAP_SIZE): World {
  return { seed, mapSize, overrides: new Map() }
}

export function hash(x: number, y: number, seed: number) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return (n ^ (n >>> 16)) >>> 0
}

export function genTile(x: number, y: number, seed: number, mapSize: number) {
  if (x < 0 || y < 0 || x >= mapSize || y >= mapSize) return WALL
  const block = 20
  const bx = x % block
  const by = y % block
  if (bx === 0 || by === 0) return ROAD
  if (bx >= 5 && bx <= 15 && by >= 5 && by <= 15) {
    const onWall = bx === 5 || bx === 15 || by === 5 || by === 15
    if (onWall) {
      if (by === 15 && bx === 10) return DOOR
      const corner = (bx === 5 || bx === 15) && (by === 5 || by === 15)
      if (!corner) {
        if (by === 5 && (bx === 8 || bx === 12)) return WINDOW
        if (by === 15 && (bx === 7 || bx === 13)) return WINDOW
        if (bx === 5 && (by === 8 || by === 12)) return WINDOW
        if (bx === 15 && (by === 8 || by === 12)) return WINDOW
      }
      return WALL
    }
    return DIRT
  }
  const pond = hash(Math.floor(x / 8), Math.floor(y / 8), seed)
  if (pond % 37 === 0) return WATER
  return GRASS
}

export function tileKey(x: number, y: number) {
  return Math.floor(x) + ',' + Math.floor(y)
}

export function getTile(w: World, x: number, y: number) {
  const k = tileKey(x, y)
  if (w.overrides.has(k)) return w.overrides.get(k)
  return genTile(Math.floor(x), Math.floor(y), w.seed, w.mapSize)
}

export function setTile(w: World, x: number, y: number, t: number) {
  w.overrides.set(tileKey(x, y), t)
}

export function chunkKey(x: number, y: number) {
  return Math.floor(x / CHUNK) + ',' + Math.floor(y / CHUNK)
}

export function isSolid(w: World, x: number, y: number) {
  return !!SOLID[getTile(w, x, y)]
}

export function isOpaque(w: World, x: number, y: number) {
  return !!OPAQUE[getTile(w, x, y)]
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
