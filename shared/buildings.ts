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
export type Building = { rooms: Room[]; style: string }

// typical 1-story mins; layout rolls grow these
export const ROOM_MIN = {
  living: { w: 5, h: 5 },
  kitchen: { w: 3, h: 3 },
  bedroom: { w: 3, h: 3 },
  bathroom: { w: 2, h: 2 },
}
export const SLOPE = { DEPTH: 1 }
export const BLOCK = 20
export const LOT_OFF = 5

function rnd(seed: number, n: number) {
  return hash(n, seed & 0xffff, (seed >>> 16) || 1)
}
function roll(seed: number, n: number, lo: number, hi: number) {
  return lo + rnd(seed, n) % (hi - lo + 1)
}
function chance(seed: number, n: number, pct: number) {
  return rnd(seed, n) % 100 < pct
}

function footprintOk(rooms: Room[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const cells = new Set<string>()
  for (const r of rooms) {
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

/** Compact bungalow 2×2 — living+kitchen south, bed+bath north. */
function layoutQuad(seed: number): Building {
  const lw = roll(seed, 1, 5, 8), lh = roll(seed, 2, 5, 7)
  const kw = roll(seed, 3, 3, 5), kh = roll(seed, 4, 3, 5)
  const bw = roll(seed, 5, 3, 5), bh = roll(seed, 6, 3, 5)
  const aw = roll(seed, 7, 2, 3), ah = roll(seed, 8, 2, 3)
  const col0 = Math.max(lw, bw)
  const col1 = Math.max(kw, aw)
  const row0 = Math.max(bh, ah)
  const row1 = Math.max(lh, kh)
  return {
    style: 'quad',
    rooms: [
      { kind: 'bedroom', x: 0, y: 0, w: col0, h: row0 },
      { kind: 'bathroom', x: col0, y: 0, w: col1, h: row0 },
      { kind: 'living', x: 0, y: row0, w: col0, h: row1 },
      { kind: 'kitchen', x: col0, y: row0, w: col1, h: row1 },
    ],
  }
}

/** Public west / private east — classic ranch bedroom wing. */
function layoutWing(seed: number): Building {
  const lw = roll(seed, 1, 5, 8), lh = roll(seed, 2, 4, 6)
  const kw = roll(seed, 3, 4, 6), kh = roll(seed, 4, 3, 5)
  const b1w = roll(seed, 5, 3, 5), b1h = roll(seed, 6, 3, 5)
  const aw = roll(seed, 7, 2, 3), ah = roll(seed, 8, 2, 3)
  const col0 = Math.max(lw, kw)
  const col1 = Math.max(b1w, aw)
  const row0 = Math.max(lh, b1h)
  const row1 = Math.max(kh, ah)
  const rooms: Room[] = [
    { kind: 'living', x: 0, y: 0, w: col0, h: row0 },
    { kind: 'bedroom', x: col0, y: 0, w: col1, h: row0 },
    { kind: 'kitchen', x: 0, y: row0, w: col0, h: row1 },
    { kind: 'bathroom', x: col0, y: row0, w: col1, h: row1 },
  ]
  // often a 2nd bedroom south of the bath (kitchen stretches)
  if (chance(seed, 9, 55)) {
    const b2h = roll(seed, 11, 3, 4)
    const b2w = Math.max(col1, roll(seed, 10, 3, 5))
    rooms[1].w = b2w
    rooms[3].w = b2w
    rooms[2].h = row1 + b2h
    rooms.push({ kind: 'bedroom', x: col0, y: row0 + row1, w: b2w, h: b2h })
  }
  return { style: 'wing', rooms }
}

/** Split-bedroom: beds on both flanks, living/kitchen in the middle. */
function layoutSplit(seed: number): Building {
  const lw = roll(seed, 1, 5, 7), lh = roll(seed, 2, 4, 6)
  const kw = roll(seed, 3, 4, 6), kh = roll(seed, 4, 3, 5)
  const blw = roll(seed, 5, 3, 5), blh = roll(seed, 6, 3, 5)
  const brw = roll(seed, 7, 3, 5), brh = roll(seed, 8, 3, 5)
  const aw = roll(seed, 9, 2, 3), ah = roll(seed, 10, 2, 3)
  const col0 = Math.max(blw, aw)
  const col1 = Math.max(lw, kw)
  const col2 = brw
  const row0 = Math.max(blh, lh, brh)
  const row1 = Math.max(ah, kh)
  return {
    style: 'split',
    rooms: [
      { kind: 'bedroom', x: 0, y: 0, w: col0, h: row0 },
      { kind: 'living', x: col0, y: 0, w: col1, h: row0 },
      { kind: 'bedroom', x: col0 + col1, y: 0, w: col2, h: row0 + row1 },
      { kind: 'bathroom', x: 0, y: row0, w: col0, h: row1 },
      { kind: 'kitchen', x: col0, y: row0, w: col1, h: row1 },
    ],
  }
}

/** Bedrooms along the north; living/kitchen on the entry (south) side. */
function layoutFront(seed: number): Building {
  const lh = roll(seed, 2, 4, 6)
  const bw = roll(seed, 5, 3, 5), bh = roll(seed, 6, 3, 5)
  const aw = roll(seed, 7, 2, 3), ah = roll(seed, 8, 2, 4)
  if (chance(seed, 9, 40)) {
    const b2w = roll(seed, 10, 3, 4), b2h = roll(seed, 11, 3, 4)
    const topH = Math.max(bh, ah, b2h)
    const col0 = Math.max(bw, roll(seed, 3, 3, 5))
    const col1 = Math.max(aw, 2)
    const col2 = Math.max(b2w, 3)
    return {
      style: 'front',
      rooms: [
        { kind: 'bedroom', x: 0, y: 0, w: col0, h: topH },
        { kind: 'bathroom', x: col0, y: 0, w: col1, h: topH },
        { kind: 'bedroom', x: col0 + col1, y: 0, w: col2, h: topH },
        { kind: 'kitchen', x: 0, y: topH, w: col0, h: lh },
        { kind: 'living', x: col0, y: topH, w: col1 + col2, h: lh },
      ],
    }
  }
  const topH = Math.max(bh, ah)
  const col0 = Math.max(bw, roll(seed, 3, 3, 5))
  const col1 = Math.max(aw, roll(seed, 1, 5, 7) - col0, 3)
  return {
    style: 'front',
    rooms: [
      { kind: 'bedroom', x: 0, y: 0, w: col0, h: topH },
      { kind: 'bathroom', x: col0, y: 0, w: col1, h: topH },
      { kind: 'kitchen', x: 0, y: topH, w: col0, h: lh },
      { kind: 'living', x: col0, y: topH, w: col1, h: lh },
    ],
  }
}

/** Long ranch bar: living | kitchen/bath stack | bedroom. */
function layoutRanch(seed: number): Building {
  const lw = roll(seed, 1, 5, 7), lh = roll(seed, 2, 5, 7)
  const kw = roll(seed, 3, 3, 5), kh = roll(seed, 4, 3, 4)
  const bw = roll(seed, 5, 3, 5), bh = roll(seed, 6, 4, 6)
  const aw = roll(seed, 7, 2, 3)
  const midW = Math.max(kw, aw)
  const row0 = Math.max(lh, kh + roll(seed, 8, 2, 3), bh)
  const kitH = Math.min(kh, row0 - 2)
  return {
    style: 'ranch',
    rooms: [
      { kind: 'living', x: 0, y: 0, w: lw, h: row0 },
      { kind: 'kitchen', x: lw, y: 0, w: midW, h: kitH },
      { kind: 'bathroom', x: lw, y: kitH, w: midW, h: row0 - kitH },
      { kind: 'bedroom', x: lw + midW, y: 0, w: bw, h: row0 },
    ],
  }
}

const STYLES = [layoutQuad, layoutWing, layoutSplit, layoutFront, layoutRanch]

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

export function layoutHouse(seed: number): Building {
  const fn = STYLES[rnd(seed, 0) % STYLES.length]
  let b = fn(seed)
  if (!footprintOk(b.rooms)) b = layoutQuad(seed ^ 0x9e3779b9)

  let rooms = b.rooms
  if (chance(seed, 100, 50)) rooms = mirrorX(rooms)
  if (chance(seed, 101, 50)) rooms = mirrorY(rooms)
  if (chance(seed, 102, 30)) rooms = rotate90(rooms)
  if (chance(seed, 103, 15)) rooms = rotate90(rooms)

  const maxSide = BLOCK - LOT_OFF - 1
  const { maxX, maxY } = (() => {
    let x = 0, y = 0
    for (const r of rooms) {
      x = Math.max(x, r.x + r.w)
      y = Math.max(y, r.y + r.h)
    }
    return { maxX: x, maxY: y }
  })()
  if (maxX > maxSide || maxY > maxSide || !footprintOk(rooms)) {
    b = layoutQuad(seed)
    rooms = b.rooms
  }
  return { style: b.style, rooms }
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

function placeFrontDoor(world: World, ox: number, oy: number, z: number, rooms: Room[], seed: number) {
  const { minX, minY, maxX, maxY } = bounds(rooms)
  const living = rooms.find(r => r.kind === 'living') || rooms[0]
  const tries: { axis: 'N' | 'W'; x: number; y: number }[] = []
  if (living.y + living.h === maxY) tries.push({ axis: 'N', x: living.x + (living.w >> 1), y: maxY })
  if (living.y === minY) tries.push({ axis: 'N', x: living.x + (living.w >> 1), y: minY })
  if (living.x === minX) tries.push({ axis: 'W', x: minX, y: living.y + (living.h >> 1) })
  if (living.x + living.w === maxX) tries.push({ axis: 'W', x: maxX, y: living.y + (living.h >> 1) })
  if (!tries.length) tries.push({ axis: 'N', x: minX + ((maxX - minX) >> 1), y: maxY })
  const t = tries[rnd(seed, 200) % tries.length]
  if (t.axis === 'N') wallN(world, ox + t.x, oy + t.y, EDGE_DOOR, z)
  else wallW(world, ox + t.x, oy + t.y, EDGE_DOOR, z)
}

export function stampBuilding(world: World, ox: number, oy: number, z: number, building: Building, corners = true, seed = 1) {
  const rooms = building.rooms
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

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const v = shareVert(rooms[i], rooms[j])
      if (v) wallN(world, ox + v.x, oy + v.y, EDGE_DOOR, z)
      const h = shareHorz(rooms[i], rooms[j])
      if (h) wallW(world, ox + h.x, oy + h.y, EDGE_DOOR, z)
    }
  }

  placeFrontDoor(world, ox, oy, z, rooms, seed)

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

  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      if (!inFoot(x, y)) continue
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
      const ox = bx * BLOCK + LOT_OFF + roll(seed, 300, 0, 2)
      const oy = by * BLOCK + LOT_OFF + roll(seed, 301, 0, 2)
      stampBuilding(world, ox, oy, 0, layoutHouse(seed), false, seed)
    }
  }
  resolveRoofCorners(world, 0)
}
