import {
  DIR_E, DIR_N, DIR_S, DIR_W,
  EDGE_DOOR, EDGE_WALL, EDGE_WINDOW,
  WOOD,
  cellKey, hash, packRoof, resolveRoofCorners,
  setEdgeN, setEdgeW, setRoof, setTile,
  type World,
} from './world.ts'

export type RoomKind = 'living' | 'kitchen' | 'bedroom' | 'bathroom'
export type Room = { kind: RoomKind; x: number; y: number; w: number; h: number }
export type Building = { rooms: Room[] }

export const ROOM_MIN = {
  living: { w: 5, h: 5 },
  kitchen: { w: 3, h: 4 },
  bedroom: { w: 4, h: 4 },
  bathroom: { w: 3, h: 3 },
}
export const SLOPE = { DEPTH: 1 }
export const BLOCK = 20
export const LOT_OFF = 5

function jitter(seed: number, n: number) {
  return hash(n, 0, seed) & 1
}

export function layoutHouse(seed: number): Building {
  const liv = { w: ROOM_MIN.living.w + jitter(seed, 1), h: ROOM_MIN.living.h + jitter(seed, 2) }
  const kit = { w: ROOM_MIN.kitchen.w + jitter(seed, 3), h: ROOM_MIN.kitchen.h + jitter(seed, 4) }
  const bed = { w: ROOM_MIN.bedroom.w + jitter(seed, 5), h: ROOM_MIN.bedroom.h + jitter(seed, 6) }
  const bath = { w: ROOM_MIN.bathroom.w + jitter(seed, 7), h: ROOM_MIN.bathroom.h + jitter(seed, 8) }
  const colW0 = Math.max(liv.w, bed.w)
  const colW1 = Math.max(kit.w, bath.w)
  const rowH0 = Math.max(bed.h, bath.h)
  const rowH1 = Math.max(liv.h, kit.h)
  return {
    rooms: [
      { kind: 'bedroom', x: 0, y: 0, w: colW0, h: rowH0 },
      { kind: 'bathroom', x: colW0, y: 0, w: colW1, h: rowH0 },
      { kind: 'living', x: 0, y: rowH0, w: colW0, h: rowH1 },
      { kind: 'kitchen', x: colW0, y: rowH0, w: colW1, h: rowH1 },
    ],
  }
}

function inRect(r: Room, x: number, y: number) {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
}

function wallN(w: World, x: number, y: number, kind: number, z: number) {
  setEdgeN(w, x, y, kind, z)
}

function wallW(w: World, x: number, y: number, kind: number, z: number) {
  setEdgeW(w, x, y, kind, z)
}

function shareVert(a: Room, b: Room) {
  if (a.y + a.h !== b.y && b.y + b.h !== a.y) return null
  const y = a.y + a.h === b.y ? a.y + a.h : b.y + b.h
  const x0 = Math.max(a.x, b.x)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  if (x1 - x0 < 1) return null
  return { x: x0 + ((x1 - x0) >> 1), y }
}

function shareHorz(a: Room, b: Room) {
  if (a.x + a.w !== b.x && b.x + b.w !== a.x) return null
  const x = a.x + a.w === b.x ? a.x + a.w : b.x + b.w
  const y0 = Math.max(a.y, b.y)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  if (y1 - y0 < 1) return null
  return { x, y: y0 + ((y1 - y0) >> 1) }
}

export function stampBuilding(world: World, ox: number, oy: number, z: number, building: Building, corners = true) {
  const rooms = building.rooms
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of rooms) {
    if (r.x < minX) minX = r.x
    if (r.y < minY) minY = r.y
    if (r.x + r.w > maxX) maxX = r.x + r.w
    if (r.y + r.h > maxY) maxY = r.y + r.h
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) setTile(world, ox + x, oy + y, WOOD, z)
    }
    for (let x = r.x; x < r.x + r.w; x++) {
      wallN(world, ox + x, oy + r.y, EDGE_WALL, z)
      wallN(world, ox + x, oy + r.y + r.h, EDGE_WALL, z)
    }
    for (let y = r.y; y < r.y + r.h; y++) {
      wallW(world, ox + r.x, oy + y, EDGE_WALL, z)
      wallW(world, ox + r.x + r.w, oy + y, EDGE_WALL, z)
    }
  }

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const v = shareVert(rooms[i], rooms[j])
      if (v) wallN(world, ox + v.x, oy + v.y, EDGE_DOOR, z)
      const h = shareHorz(rooms[i], rooms[j])
      if (h) wallW(world, ox + h.x, oy + h.y, EDGE_DOOR, z)
    }
  }

  const doorX = minX + ((maxX - minX) >> 1)
  wallN(world, ox + doorX, oy + maxY, EDGE_DOOR, z)

  const inFoot = (x: number, y: number) => rooms.some(r => inRect(r, x, y))
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const south = inFoot(x, y)
      const north = inFoot(x, y - 1)
      if (south !== north) {
        const k = world.edgesN.get(cellKey(ox + x, oy + y, z))
        if (k === EDGE_WALL && (x + y) % 2 === 0) wallN(world, ox + x, oy + y, EDGE_WINDOW, z)
      }
      const east = inFoot(x, y)
      const west = inFoot(x - 1, y)
      if (east !== west) {
        const k = world.edgesW.get(cellKey(ox + x, oy + y, z))
        if (k === EDGE_WALL && (x + y) % 2 === 0) wallW(world, ox + x, oy + y, EDGE_WINDOW, z)
      }
    }
  }

  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const dN = y - minY
      const dS = maxY - 1 - y
      const dW = x - minX
      const dE = maxX - 1 - x
      let dist = dN, dir = DIR_N
      if (dE < dist) { dist = dE; dir = DIR_E }
      if (dS < dist) { dist = dS; dir = DIR_S }
      if (dW < dist) { dist = dW; dir = DIR_W }
      if (dist < SLOPE.DEPTH) setRoof(world, ox + x, oy + y, true, z, packRoof(dir, dist))
      else setRoof(world, ox + x, oy + y, true, z, -1)
    }
  }
  if (corners) resolveRoofCorners(world, z)
}

export function stampTown(world: World) {
  const n = Math.floor(world.mapSize / BLOCK)
  for (let by = 0; by < n; by++) {
    for (let bx = 0; bx < n; bx++) {
      const seed = hash(bx, by, world.seed)
      stampBuilding(world, bx * BLOCK + LOT_OFF, by * BLOCK + LOT_OFF, 0, layoutHouse(seed), false)
    }
  }
  resolveRoofCorners(world, 0)
}
