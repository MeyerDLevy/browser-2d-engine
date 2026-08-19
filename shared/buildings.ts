import {
  DIR_E, DIR_N, DIR_S, DIR_W,
  EDGE_DOOR, EDGE_WALL, EDGE_WINDOW,
  DIRT, GRASS, ROAD, WOOD,
  cellKey, hash, packRoof, packRoofCorner,
  CORNER_NE, CORNER_NW, CORNER_SE, CORNER_SW,
  resolveRoofCorners, getTile, setEdgeN, setEdgeW, setRoof, setTile, setObject,
  type World,
} from './world.ts'
import {
  BUILDING_SPECS, COMMERCIAL_QUOTA, MAX_HOUSES, SIM_BLOCK_RADIUS,
  type BuildingKind,
} from './town/config.ts'

export type RoomKind = 'living' | 'kitchen' | 'bedroom' | 'bathroom' | 'hallway'
export type Room = { kind: RoomKind; x: number; y: number; w: number; h: number }
export type Building = { rooms: Room[]; style: string; front: Side }
export type Side = 'N' | 'E' | 'S' | 'W'
export type Plot = { x: number; y: number; w: number; h: number; front: Side }
export type SimSite = {
  kind: BuildingKind
  ox: number
  oy: number
  w: number
  h: number
  door: { x: number; y: number; z: number }
  anchors: Record<string, { x: number; y: number; z: number }>
  sim: boolean
}

export const ROOM_MIN = {
  living: { w: 4, h: 4 },
  kitchen: { w: 3, h: 3 },
  bedroom: { w: 3, h: 3 },
  bathroom: { w: 2, h: 2 },
  hallway: { w: 2, h: 2 },
}
export const SLOPE = { DEPTH: 1 }
export const BLOCK = 20
/** tiles between road and plot edge (sidewalk / setback) */
export const SETBACK = 2
/** yard inset inside a plot before the house footprint */
export const YARD = 1

function rnd(seed: number, n: number) {
  return hash(n, seed & 0xffff, (seed >>> 16) || 1)
}
function roll(seed: number, n: number, lo: number, hi: number) {
  if (hi < lo) return lo
  return lo + rnd(seed, n) % (hi - lo + 1)
}
function chance(seed: number, n: number, pct: number) {
  return rnd(seed, n) % 100 < pct
}

function footprintOk(rooms: Room[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const cells = new Set<string>()
  for (const r of rooms) {
    if (r.w < 1 || r.h < 1) return false
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const k = x + ',' + y
        if (cells.has(k)) return false
        cells.add(k)
      }
    }
  }
  return cells.size === (maxX - minX) * (maxY - minY)
}

function bounds(rooms: Room[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of rooms) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  return { minX, minY, maxX, maxY }
}

function sizeOf(rooms: Room[]) {
  const b = bounds(rooms)
  return { w: b.maxX - b.minX, h: b.maxY - b.minY }
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

function adjacent(a: Room, b: Room) {
  return !!(shareVert(a, b) || shareHorz(a, b))
}

/** Every room must reach living (or hallway hub) through shared walls. */
function connected(rooms: Room[]) {
  if (!rooms.length) return false
  const hub = rooms.findIndex(r => r.kind === 'living')
  const start = hub >= 0 ? hub : rooms.findIndex(r => r.kind === 'hallway')
  if (start < 0) return false
  const seen = new Set<number>([start])
  const q = [start]
  while (q.length) {
    const i = q.pop()
    for (let j = 0; j < rooms.length; j++) {
      if (seen.has(j)) continue
      if (adjacent(rooms[i], rooms[j])) {
        seen.add(j)
        q.push(j)
      }
    }
  }
  return seen.size === rooms.length
}

function mirrorX(rooms: Room[]): Room[] {
  let maxX = 0
  for (const r of rooms) maxX = Math.max(maxX, r.x + r.w)
  return rooms.map(r => ({ ...r, x: maxX - r.x - r.w }))
}

function mirrorY(rooms: Room[]): Room[] {
  let maxY = 0
  for (const r of rooms) maxY = Math.max(maxY, r.y + r.h)
  return rooms.map(r => ({ ...r, y: maxY - r.y - r.h }))
}

function rotate90(rooms: Room[]): Room[] {
  let maxX = 0
  for (const r of rooms) maxX = Math.max(maxX, r.x + r.w)
  const out = rooms.map(r => ({
    kind: r.kind,
    x: r.y,
    y: maxX - r.x - r.w,
    w: r.h,
    h: r.w,
  }))
  let minX = Infinity, minY = Infinity
  for (const r of out) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
  }
  return out.map(r => ({ ...r, x: r.x - minX, y: r.y - minY }))
}

function livingTouches(rooms: Room[], side: Side) {
  const liv = rooms.find(r => r.kind === 'living')
  if (!liv) return false
  const b = bounds(rooms)
  if (side === 'S') return liv.y + liv.h === b.maxY
  if (side === 'N') return liv.y === b.minY
  if (side === 'W') return liv.x === b.minX
  return liv.x + liv.w === b.maxX
}

/** Rotate/mirror until living sits on the street-facing facade. */
function orientToFront(rooms: Room[], front: Side, seed: number): Room[] {
  let best = rooms
  for (let i = 0; i < 4; i++) {
    let r = rooms
    for (let k = 0; k < i; k++) r = rotate90(r)
    if (chance(seed, 110 + i, 50)) r = mirrorX(r)
    if (livingTouches(r, front)) return r
    best = r
  }
  // force: put living on the front edge by mirroring
  let r = best
  if (front === 'S' || front === 'N') {
    if (!livingTouches(r, front)) r = mirrorY(r)
  } else if (!livingTouches(r, front)) {
    r = mirrorX(r)
  }
  return r
}

function clampRoll(seed: number, n: number, lo: number, hi: number, cap: number) {
  return roll(seed, n, lo, Math.min(hi, Math.max(lo, cap)))
}

/** Compact bungalow that always fits small plots. */
function layoutCompact(seed: number, maxW: number, maxH: number): Building {
  // living | kitchen
  // bed    | bath   — or with hallway strip
  const useHall = maxW >= 7 && maxH >= 6 && chance(seed, 1, 40)
  if (useHall) {
    // [bed ][hall][bath]
    // [  living ][kit ]
    const bw = clampRoll(seed, 2, 3, 4, maxW - 4)
    const aw = 2
    const hw = 2
    const topH = clampRoll(seed, 3, 2, 3, maxH - 3)
    const livH = clampRoll(seed, 4, 3, 4, maxH - topH)
    const kitW = clampRoll(seed, 5, 3, 4, maxW - bw - hw)
    // ensure width fits: bw+hw+aw or living spans
    const topW = bw + hw + aw
    const botW = Math.max(topW, bw + hw + kitW)
    const scale = Math.min(1, maxW / botW, maxH / (topH + livH))
    const rooms: Room[] = [
      { kind: 'bedroom', x: 0, y: 0, w: bw, h: topH },
      { kind: 'hallway', x: bw, y: 0, w: hw, h: topH },
      { kind: 'bathroom', x: bw + hw, y: 0, w: aw, h: topH },
      { kind: 'living', x: 0, y: topH, w: bw + hw, h: livH },
      { kind: 'kitchen', x: bw + hw, y: topH, w: Math.max(aw, kitW), h: livH },
    ]
    // if too wide/tall, fall through
    const s = sizeOf(rooms)
    if (s.w <= maxW && s.h <= maxH && footprintOk(rooms) && connected(rooms)) {
      return { style: 'hall', rooms, front: 'S' }
    }
  }
  const col0 = clampRoll(seed, 10, 3, 5, maxW - 2)
  const col1 = Math.min(clampRoll(seed, 11, 2, 4, maxW - col0), maxW - col0)
  const row0 = clampRoll(seed, 12, 2, 4, maxH - 3)
  const row1 = Math.min(clampRoll(seed, 13, 3, 5, maxH - row0), maxH - row0)
  const rooms: Room[] = [
    { kind: 'bedroom', x: 0, y: 0, w: col0, h: row0 },
    { kind: 'bathroom', x: col0, y: 0, w: col1, h: row0 },
    { kind: 'living', x: 0, y: row0, w: col0, h: row1 },
    { kind: 'kitchen', x: col0, y: row0, w: col1, h: row1 },
  ]
  return { style: 'quad', rooms, front: 'S' }
}

function layoutWing(seed: number, maxW: number, maxH: number): Building | null {
  if (maxW < 6 || maxH < 6) return null
  const col0 = clampRoll(seed, 1, 3, 5, maxW - 3)
  const col1 = Math.min(clampRoll(seed, 2, 3, 4, maxW - col0), maxW - col0)
  const row0 = clampRoll(seed, 3, 3, 5, maxH - 3)
  const row1 = Math.min(clampRoll(seed, 4, 2, 4, maxH - row0), maxH - row0)
  const rooms: Room[] = [
    { kind: 'living', x: 0, y: 0, w: col0, h: row0 },
    { kind: 'bedroom', x: col0, y: 0, w: col1, h: row0 },
    { kind: 'kitchen', x: 0, y: row0, w: col0, h: row1 },
    { kind: 'bathroom', x: col0, y: row0, w: col1, h: row1 },
  ]
  if (maxH - row0 - row1 >= 3 && chance(seed, 5, 50)) {
    const b2h = Math.min(3, maxH - row0 - row1)
    rooms[2].h = row1 + b2h
    rooms.push({ kind: 'bedroom', x: col0, y: row0 + row1, w: col1, h: b2h })
  }
  if (!footprintOk(rooms) || !connected(rooms)) return null
  const s = sizeOf(rooms)
  if (s.w > maxW || s.h > maxH) return null
  return { style: 'wing', rooms, front: 'S' }
}

function layoutSplit(seed: number, maxW: number, maxH: number): Building | null {
  if (maxW < 8 || maxH < 5) return null
  const col0 = clampRoll(seed, 1, 2, 3, Math.floor(maxW / 3))
  const col2 = clampRoll(seed, 2, 2, 3, Math.floor(maxW / 3))
  const col1 = Math.min(clampRoll(seed, 3, 3, 5, maxW - col0 - col2), maxW - col0 - col2)
  if (col1 < 3) return null
  const row0 = clampRoll(seed, 4, 3, 4, maxH - 2)
  const row1 = Math.min(clampRoll(seed, 5, 2, 3, maxH - row0), maxH - row0)
  const rooms: Room[] = [
    { kind: 'bedroom', x: 0, y: 0, w: col0, h: row0 },
    { kind: 'living', x: col0, y: 0, w: col1, h: row0 },
    { kind: 'bedroom', x: col0 + col1, y: 0, w: col2, h: row0 + row1 },
    { kind: 'bathroom', x: 0, y: row0, w: col0, h: row1 },
    { kind: 'kitchen', x: col0, y: row0, w: col1, h: row1 },
  ]
  if (!footprintOk(rooms) || !connected(rooms)) return null
  const s = sizeOf(rooms)
  if (s.w > maxW || s.h > maxH) return null
  return { style: 'split', rooms, front: 'S' }
}

function layoutFront(seed: number, maxW: number, maxH: number): Building | null {
  if (maxW < 6 || maxH < 5) return null
  const topH = clampRoll(seed, 1, 2, 3, maxH - 3)
  const livH = Math.min(clampRoll(seed, 2, 3, 4, maxH - topH), maxH - topH)
  if (maxW >= 8 && chance(seed, 3, 45)) {
    const col0 = clampRoll(seed, 4, 3, 4, maxW - 5)
    const col1 = 2
    const col2 = Math.min(clampRoll(seed, 5, 3, 4, maxW - col0 - col1), maxW - col0 - col1)
    const rooms: Room[] = [
      { kind: 'bedroom', x: 0, y: 0, w: col0, h: topH },
      { kind: 'bathroom', x: col0, y: 0, w: col1, h: topH },
      { kind: 'bedroom', x: col0 + col1, y: 0, w: col2, h: topH },
      { kind: 'kitchen', x: 0, y: topH, w: col0, h: livH },
      { kind: 'living', x: col0, y: topH, w: col1 + col2, h: livH },
    ]
    if (footprintOk(rooms) && connected(rooms) && sizeOf(rooms).w <= maxW && sizeOf(rooms).h <= maxH) {
      return { style: 'front', rooms, front: 'S' }
    }
  }
  const col0 = clampRoll(seed, 6, 3, 4, maxW - 2)
  const col1 = Math.min(clampRoll(seed, 7, 3, 5, maxW - col0), maxW - col0)
  const rooms: Room[] = [
    { kind: 'bedroom', x: 0, y: 0, w: col0, h: topH },
    { kind: 'bathroom', x: col0, y: 0, w: col1, h: topH },
    { kind: 'kitchen', x: 0, y: topH, w: col0, h: livH },
    { kind: 'living', x: col0, y: topH, w: col1, h: livH },
  ]
  if (!footprintOk(rooms) || !connected(rooms)) return null
  const s = sizeOf(rooms)
  if (s.w > maxW || s.h > maxH) return null
  return { style: 'front', rooms, front: 'S' }
}

function layoutRanch(seed: number, maxW: number, maxH: number): Building | null {
  if (maxW < 8 || maxH < 4) return null
  const lw = clampRoll(seed, 1, 3, 5, maxW - 5)
  const midW = clampRoll(seed, 2, 2, 3, 3)
  const bw = Math.min(clampRoll(seed, 3, 3, 4, maxW - lw - midW), maxW - lw - midW)
  const row0 = clampRoll(seed, 4, 4, 6, maxH)
  const kitH = Math.min(clampRoll(seed, 5, 2, 3, row0 - 2), row0 - 2)
  const rooms: Room[] = [
    { kind: 'living', x: 0, y: 0, w: lw, h: row0 },
    { kind: 'kitchen', x: lw, y: 0, w: midW, h: kitH },
    { kind: 'bathroom', x: lw, y: kitH, w: midW, h: row0 - kitH },
    { kind: 'bedroom', x: lw + midW, y: 0, w: bw, h: row0 },
  ]
  if (!footprintOk(rooms) || !connected(rooms)) return null
  const s = sizeOf(rooms)
  if (s.w > maxW || s.h > maxH) return null
  return { style: 'ranch', rooms, front: 'S' }
}

const TRY = [layoutWing, layoutSplit, layoutFront, layoutRanch]

/**
 * Layout a house that fits in maxW×maxH, with living on `front` facade.
 * Rooms form a connected graph through shared walls (no orphans).
 */
export function layoutHouse(seed: number, maxW = 12, maxH = 12, front: Side = 'S'): Building {
  const mw = Math.max(5, maxW)
  const mh = Math.max(5, maxH)
  // generate as south-facing then orient; swap caps when we'll need a 90° turn
  const rot = front === 'E' || front === 'W'
  const genW = rot ? mh : mw
  const genH = rot ? mw : mh

  const order = [...TRY]
  for (let i = order.length - 1; i > 0; i--) {
    const j = rnd(seed, 20 + i) % (i + 1)
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  let b: Building | null = null
  for (const fn of order) {
    b = fn(seed, genW, genH)
    if (b) break
  }
  if (!b) b = layoutCompact(seed, genW, genH)

  let rooms = orientToFront(b.rooms, front, seed)
  let sz = sizeOf(rooms)
  if (!footprintOk(rooms) || !connected(rooms) || sz.w > mw || sz.h > mh) {
    b = layoutCompact(seed ^ 0xabcdef, genW, genH)
    rooms = orientToFront(b.rooms, front, seed)
    sz = sizeOf(rooms)
  }
  if (sz.w > mw || sz.h > mh || !connected(rooms) || !footprintOk(rooms)) {
    // last resort: tiny south-facing quad, then force-orient with mirrors only
    b = layoutCompact(seed ^ 0x111, Math.min(genW, 5), Math.min(genH, 5))
    rooms = b.rooms
    if (front === 'N') rooms = mirrorY(rooms)
    if (front === 'E') rooms = rotate90(rooms)
    if (front === 'W') { rooms = rotate90(rooms); rooms = rotate90(rooms); rooms = rotate90(rooms) }
  }
  const bb = bounds(rooms)
  rooms = rooms.map(r => ({ ...r, x: r.x - bb.minX, y: r.y - bb.minY }))
  return { style: b.style, rooms, front }
}

/** Split a city block into 2 or 4 road-facing plots. */
export function plotsForBlock(blockX: number, blockY: number, seed: number): Plot[] {
  const ox = blockX * BLOCK
  const oy = blockY * BLOCK
  // interior after setback from roads on all four sides (roads at 0 and next block)
  const ix = ox + SETBACK
  const iy = oy + SETBACK
  const iw = BLOCK - 2 * SETBACK
  const ih = BLOCK - 2 * SETBACK
  const gap = 1
  const four = chance(seed, 0, 55)

  if (four) {
    const pw = Math.floor((iw - gap) / 2)
    const ph = Math.floor((ih - gap) / 2)
    const x1 = ix
    const x2 = ix + pw + gap
    const y1 = iy
    const y2 = iy + ph + gap
    // corner plots: pick which road to face
    const nwFront: Side = chance(seed, 1, 50) ? 'N' : 'W'
    const neFront: Side = chance(seed, 2, 50) ? 'N' : 'E'
    const swFront: Side = chance(seed, 3, 50) ? 'S' : 'W'
    const seFront: Side = chance(seed, 4, 50) ? 'S' : 'E'
    return [
      { x: x1, y: y1, w: pw, h: ph, front: nwFront },
      { x: x2, y: y1, w: iw - pw - gap, h: ph, front: neFront },
      { x: x1, y: y2, w: pw, h: ih - ph - gap, front: swFront },
      { x: x2, y: y2, w: iw - pw - gap, h: ih - ph - gap, front: seFront },
    ]
  }

  if (chance(seed, 5, 50)) {
    // east / west halves
    const pw = Math.floor((iw - gap) / 2)
    return [
      { x: ix, y: iy, w: pw, h: ih, front: 'W' },
      { x: ix + pw + gap, y: iy, w: iw - pw - gap, h: ih, front: 'E' },
    ]
  }
  // north / south halves
  const ph = Math.floor((ih - gap) / 2)
  return [
    { x: ix, y: iy, w: iw, h: ph, front: 'N' },
    { x: ix, y: iy + ph + gap, w: iw, h: ih - ph - gap, front: 'S' },
  ]
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

export type DoorHit = { x: number; y: number; side: Side }

function placeFrontDoor(world: World, ox: number, oy: number, z: number, rooms: Room[], front: Side): DoorHit {
  const { minX, minY, maxX, maxY } = bounds(rooms)
  const living = rooms.find(r => r.kind === 'living') || rooms[0]
  let x = living.x + (living.w >> 1)
  let y = living.y + (living.h >> 1)
  if (front === 'S') {
    x = Math.min(Math.max(living.x, x), living.x + living.w - 1)
    y = maxY
    wallN(world, ox + x, oy + y, EDGE_DOOR, z)
    return { x: ox + x, y: oy + y, side: 'S' }
  }
  if (front === 'N') {
    x = Math.min(Math.max(living.x, x), living.x + living.w - 1)
    y = minY
    wallN(world, ox + x, oy + y, EDGE_DOOR, z)
    return { x: ox + x, y: oy + y - 1, side: 'N' }
  }
  if (front === 'W') {
    y = Math.min(Math.max(living.y, y), living.y + living.h - 1)
    x = minX
    wallW(world, ox + x, oy + y, EDGE_DOOR, z)
    return { x: ox + x - 1, y: oy + y, side: 'W' }
  }
  y = Math.min(Math.max(living.y, y), living.y + living.h - 1)
  x = maxX
  wallW(world, ox + x, oy + y, EDGE_DOOR, z)
  return { x: ox + x, y: oy + y, side: 'E' }
}

/** Paint DIRT from the first exterior tile at the door out to the ROAD. */
export function stampSidewalk(world: World, door: DoorHit, z = 0) {
  let x = door.x
  let y = door.y
  const dx = door.side === 'E' ? 1 : door.side === 'W' ? -1 : 0
  const dy = door.side === 'S' ? 1 : door.side === 'N' ? -1 : 0
  for (let i = 0; i < BLOCK + 2; i++) {
    if (x < 0 || y < 0 || x >= world.mapSize || y >= world.mapSize) break
    const t = getTile(world, x, y, z)
    if (t === ROAD) break
    if (t === GRASS || t === DIRT || t == null) setTile(world, x, y, DIRT, z)
    // stop if we hit wood (shouldn't) — skip over nothing
    if (t === WOOD) {
      x += dx
      y += dy
      continue
    }
    x += dx
    y += dy
    if (getTile(world, x, y, z) === ROAD) break
  }
}

/** Full slope ring: cardinal eaves + explicit hip corners. */
function stampRoofRing(world: World, ox: number, oy: number, z: number, rooms: Room[]) {
  const { minX, minY, maxX, maxY } = bounds(rooms)
  const inFoot = (x: number, y: number) => rooms.some(r => inRect(r, x, y))

  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      if (!inFoot(x, y)) continue
      const openN = !inFoot(x, y - 1)
      const openS = !inFoot(x, y + 1)
      const openW = !inFoot(x - 1, y)
      const openE = !inFoot(x + 1, y)
      const wx = ox + x
      const wy = oy + y

      // outer hip corners (two open sides)
      if (openN && openE) {
        setRoof(world, wx, wy, true, z, packRoofCorner(CORNER_NE, 0))
        continue
      }
      if (openN && openW) {
        setRoof(world, wx, wy, true, z, packRoofCorner(CORNER_NW, 0))
        continue
      }
      if (openS && openE) {
        setRoof(world, wx, wy, true, z, packRoofCorner(CORNER_SE, 0))
        continue
      }
      if (openS && openW) {
        setRoof(world, wx, wy, true, z, packRoofCorner(CORNER_SW, 0))
        continue
      }

      // edge slopes — downhill toward outside
      if (openN) {
        setRoof(world, wx, wy, true, z, packRoof(DIR_N, 0))
        continue
      }
      if (openS) {
        setRoof(world, wx, wy, true, z, packRoof(DIR_S, 0))
        continue
      }
      if (openW) {
        setRoof(world, wx, wy, true, z, packRoof(DIR_W, 0))
        continue
      }
      if (openE) {
        setRoof(world, wx, wy, true, z, packRoof(DIR_E, 0))
        continue
      }

      // interior: flat
      setRoof(world, wx, wy, true, z, -1)
    }
  }
}

export function stampBuilding(
  world: World,
  ox: number,
  oy: number,
  z: number,
  building: Building,
  corners = true,
  seed = 1,
): DoorHit | null {
  const rooms = building.rooms
  const front = building.front || 'S'
  const { minX, minY, maxX, maxY } = bounds(rooms)

  for (const r of rooms) {
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

  // interior doors on every shared wall
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const v = shareVert(rooms[i], rooms[j])
      if (v) wallN(world, ox + v.x, oy + v.y, EDGE_DOOR, z)
      const h = shareHorz(rooms[i], rooms[j])
      if (h) wallW(world, ox + h.x, oy + h.y, EDGE_DOOR, z)
    }
  }

  const door = placeFrontDoor(world, ox, oy, z, rooms, front)

  const inFoot = (x: number, y: number) => rooms.some(r => inRect(r, x, y))
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (inFoot(x, y) !== inFoot(x, y - 1)) {
        const k = world.edgesN.get(cellKey(ox + x, oy + y, z))
        if (k === EDGE_WALL && (x + y + seed) % 2 === 0) wallN(world, ox + x, oy + y, EDGE_WINDOW, z)
      }
      if (inFoot(x, y) !== inFoot(x - 1, y)) {
        const k = world.edgesW.get(cellKey(ox + x, oy + y, z))
        if (k === EDGE_WALL && (x + y + seed) % 2 === 0) wallW(world, ox + x, oy + y, EDGE_WINDOW, z)
      }
    }
  }

  stampRoofRing(world, ox, oy, z, rooms)
  if (corners) resolveRoofCorners(world, z)
  return door
}

function layoutCommercial(kind: BuildingKind, maxW: number, maxH: number, front: Side): Building {
  const spec = kind === 'house' ? { size: { w: 6, h: 5 } } : BUILDING_SPECS[kind]
  const w = Math.max(5, Math.min(maxW, spec.size.w))
  const h = Math.max(5, Math.min(maxH, spec.size.h))
  const rooms: Room[] = [{ kind: 'living', x: 0, y: 0, w, h }]
  if ((kind === 'grocery' || kind === 'gas_station' || kind === 'warehouse' || kind === 'library') && h >= 7) {
    rooms[0].h = h - 2
    rooms.push({ kind: 'hallway', x: 0, y: h - 2, w, h: 2 })
  }
  return { style: kind, rooms, front }
}

function interiorSpot(ox: number, oy: number, w: number, h: number, fx: number, fy: number, z = 0) {
  const x0 = ox + 1.2
  const x1 = ox + w - 1.2
  const y0 = oy + 1.2
  const y1 = oy + h - 1.2
  return { x: x0 + fx * (x1 - x0), y: y0 + fy * (y1 - y0), z }
}

function roomSpot(ox: number, oy: number, r: Room, fx = 0.5, fy = 0.5, z = 0) {
  return { x: ox + r.x + 0.4 + fx * Math.max(0.2, r.w - 0.8), y: oy + r.y + 0.4 + fy * Math.max(0.2, r.h - 0.8), z }
}

function makeAnchors(kind: BuildingKind, ox: number, oy: number, w: number, h: number, rooms: Room[], door: DoorHit, z: number) {
  const anchors: Record<string, { x: number; y: number; z: number }> = {
    door: { x: door.x + 0.5, y: door.y + 0.5, z },
    bed: interiorSpot(ox, oy, w, h, 0.25, 0.35, z),
    bed2: interiorSpot(ox, oy, w, h, 0.75, 0.35, z),
    shelf: interiorSpot(ox, oy, w, h, 0.25, 0.65, z),
    kitchen: interiorSpot(ox, oy, w, h, 0.25, 0.85, z),
    bathroom: interiorSpot(ox, oy, w, h, 0.85, 0.55, z),
    couch: interiorSpot(ox, oy, w, h, 0.55, 0.55, z),
    counter: interiorSpot(ox, oy, w, h, 0.75, 0.65, z),
    work: interiorSpot(ox, oy, w, h, 0.75, 0.65, z),
    backroom: interiorSpot(ox, oy, w, h, 0.85, 0.25, z),
  }
  const bed = rooms.filter(r => r.kind === 'bedroom')
  const kit = rooms.find(r => r.kind === 'kitchen')
  const bath = rooms.find(r => r.kind === 'bathroom')
  const liv = rooms.find(r => r.kind === 'living')
  const hall = rooms.find(r => r.kind === 'hallway')
  if (bed[0]) anchors.bed = roomSpot(ox, oy, bed[0], 0.5, 0.5, z)
  if (bed[1]) anchors.bed2 = roomSpot(ox, oy, bed[1], 0.5, 0.5, z)
  else if (bed[0]) anchors.bed2 = roomSpot(ox, oy, bed[0], 0.75, 0.75, z)
  if (kit) {
    anchors.kitchen = roomSpot(ox, oy, kit, 0.5, 0.5, z)
    anchors.shelf = roomSpot(ox, oy, kit, 0.2, 0.2, z)
  }
  if (bath) anchors.bathroom = roomSpot(ox, oy, bath, 0.5, 0.5, z)
  if (liv) {
    anchors.couch = roomSpot(ox, oy, liv, 0.4, 0.4, z)
    if (kind !== 'house') {
      anchors.counter = roomSpot(ox, oy, liv, 0.7, 0.6, z)
      anchors.work = roomSpot(ox, oy, liv, 0.7, 0.35, z)
      anchors.shelf = roomSpot(ox, oy, liv, 0.3, 0.6, z)
    }
  }
  if (kind === 'church' && liv) {
    anchors.work = roomSpot(ox, oy, liv, 0.5, 0.2, z)
    anchors.counter = roomSpot(ox, oy, liv, 0.5, 0.7, z)
  }
  if (hall) anchors.backroom = roomSpot(ox, oy, hall, 0.5, 0.5, z)
  return anchors
}

function furnish(world: World, kind: BuildingKind, ox: number, oy: number, rooms: Room[], z: number, seed: number) {
  const bed = rooms.filter(r => r.kind === 'bedroom')
  const kit = rooms.find(r => r.kind === 'kitchen')
  const bath = rooms.find(r => r.kind === 'bathroom')
  const liv = rooms.find(r => r.kind === 'living')
  if (kind === 'house') {
    if (bed[0]) setObject(world, ox + bed[0].x, oy + bed[0].y, 5, 0, z)
    if (bed[1]) setObject(world, ox + bed[1].x, oy + bed[1].y, 5, 0, z)
    if (kit) setObject(world, ox + kit.x, oy + kit.y, 0, 0, z)
    if (bath) setObject(world, ox + bath.x, oy + bath.y, 3, 0, z)
    if (liv) setObject(world, ox + liv.x, oy + liv.y, 4, 0, z)
    return
  }
  if (liv) {
    const obj = kind === 'warehouse' || kind === 'grocery' || kind === 'gas_station' ? 1 : 6
    setObject(world, ox + liv.x + Math.min(1, liv.w - 1), oy + liv.y, obj, seed & 3, z)
  }
}

/** Place a building on a plot (fits buildable area, front door + sidewalk to road). */
export function stampPlot(world: World, plot: Plot, seed: number, z = 0, kind: BuildingKind = 'house'): SimSite | null {
  const buildW = plot.w - 2 * YARD
  const buildH = plot.h - 2 * YARD
  if (buildW < 5 || buildH < 5) return null

  const building = kind === 'house'
    ? layoutHouse(seed, buildW, buildH, plot.front)
    : layoutCommercial(kind, buildW, buildH, plot.front)
  const sz = sizeOf(building.rooms)
  let ox = plot.x + YARD + Math.max(0, Math.floor((buildW - sz.w) / 2))
  let oy = plot.y + YARD + Math.max(0, Math.floor((buildH - sz.h) / 2))
  if (plot.front === 'N') oy = plot.y + YARD
  if (plot.front === 'S') oy = plot.y + plot.h - YARD - sz.h
  if (plot.front === 'W') ox = plot.x + YARD
  if (plot.front === 'E') ox = plot.x + plot.w - YARD - sz.w

  const door = stampBuilding(world, ox, oy, z, building, false, seed)
  if (door) stampSidewalk(world, door, z)
  furnish(world, kind, ox, oy, building.rooms, z, seed)
  const hit = door || { x: ox, y: oy + sz.h, side: plot.front }
  return {
    kind,
    ox, oy, w: sz.w, h: sz.h,
    door: { x: hit.x + 0.5, y: hit.y + 0.5, z },
    anchors: makeAnchors(kind, ox, oy, sz.w, sz.h, building.rooms, hit, z),
    sim: false,
  }
}

const OUTSIDE_KINDS: BuildingKind[] = ['gas_station', 'grocery', 'bar', 'church', 'library', 'warehouse', 'big_box', 'town_hall']

export function stampTown(world: World): SimSite[] {
  const n = Math.floor(world.mapSize / BLOCK)
  const cx = Math.floor(n / 2)
  const cy = Math.floor(n / 2)
  const quota = [...COMMERCIAL_QUOTA]
  let simHouses = 0
  const sites: SimSite[] = []
  for (let by = 0; by < n; by++) {
    for (let bx = 0; bx < n; bx++) {
      const seed = hash(bx, by, world.seed)
      const plots = plotsForBlock(bx, by, seed)
      const inSim = Math.abs(bx - cx) <= SIM_BLOCK_RADIUS && Math.abs(by - cy) <= SIM_BLOCK_RADIUS
      plots.forEach((p, i) => {
        const ps = hash(seed, i, 99)
        let kind: BuildingKind = 'house'
        let sim = false
        if (inSim) {
          if (quota.length) {
            kind = quota.shift()
            sim = true
          } else {
            kind = 'house'
            sim = simHouses < MAX_HOUSES
            if (sim) simHouses++
          }
        } else if (ps % 14 === 0) {
          kind = OUTSIDE_KINDS[ps % OUTSIDE_KINDS.length]
        }
        const site = stampPlot(world, p, ps, 0, kind)
        if (!site) {
          if (inSim && kind !== 'house') quota.unshift(kind)
          if (inSim && kind === 'house' && sim) simHouses = Math.max(0, simHouses - 1)
          return
        }
        site.sim = sim
        sites.push(site)
      })
    }
  }
  resolveRoofCorners(world, 0)
  world.sites = sites
  return sites
}
