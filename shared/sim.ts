import {
  INTEREST, MAX_Z, getTile, hash, isSolid, edgeBlocks, edgeN, edgeW,
  getStairs, dirDelta, makeWorld, ROAD, objectBlocks,
} from './world.ts'
import {
  ENTER_RANGE, ITEM_TYPES, INV_MAX, MELEE_DMG, MELEE_RANGE, PICKUP_RANGE,
  PLAYER_COLORS, PLAYER_R, PLAYER_SPEED, VEHICLE_SPEED,
  type Entity, type GameState, type Item,
} from './entities.ts'
import type { World } from './world.ts'
import type { Input } from './protocol.ts'

export function nid(s: GameState, prefix: string) {
  return prefix + s.nextId++
}

export function createGame(seed: number, mapSize: number, blank = false): GameState {
  const world = makeWorld(seed, mapSize, blank)
  const s: GameState = { world, entities: new Map(), nextId: 1 }
  const cx = Math.floor(mapSize / 2)
  const cy = Math.floor(mapSize / 2)
  for (let i = 0; i < 80; i++) {
    let x = cx + (hash(i, 1, seed) % 200) - 100
    let y = cy + (hash(i, 2, seed) % 200) - 100
    if (getTile(world, x, y, 0) !== ROAD) {
      x = cx + (i % 20) - 10
      y = cy
    }
    const spec = ITEM_TYPES[i % ITEM_TYPES.length]
    spawnItem(s, x + 0.5, y + 0.5, spec)
  }
  for (let i = 0; i < 8; i++) spawnVehicle(s, cx + 2 + i * 3 + 0.5, cy + 0.5)
  return s
}

export function spawnItem(s: GameState, x: number, y: number, spec: Item, z = 0) {
  const e: Entity = {
    id: nid(s, 'i'), kind: 'item', x, y, z, facing: 0,
    itemType: spec.type, name: spec.name,
  }
  s.entities.set(e.id, e)
  return e
}

export function spawnVehicle(s: GameState, x: number, y: number) {
  const e: Entity = { id: nid(s, 'v'), kind: 'vehicle', x, y, z: 0, facing: 0, name: 'car' }
  s.entities.set(e.id, e)
  return e
}

export function spawnPlayer(s: GameState, name: string) {
  const n = [...s.entities.values()].filter(e => e.kind === 'player').length
  const cx = Math.floor(s.world.mapSize / 2)
  const cy = Math.floor(s.world.mapSize / 2)
  const e: Entity = {
    id: nid(s, 'p'),
    kind: 'player',
    x: cx - 8 + n * 1.5 + 0.5,
    y: cy + 0.5,
    z: 0,
    facing: 0,
    name,
    health: 100,
    maxHealth: 100,
    inventory: [],
    attackCd: 0,
    seq: 0,
    color: PLAYER_COLORS[n % PLAYER_COLORS.length],
  }
  s.entities.set(e.id, e)
  return e
}

function solidAt(w: World, x: number, y: number, z: number) {
  return isSolid(w, x, y, z) || objectBlocks(w, x, y, z)
}

function floorBlocked(w: World, x: number, y: number, z: number, r: number) {
  return solidAt(w, x - r, y - r, z) || solidAt(w, x + r, y - r, z) ||
    solidAt(w, x - r, y + r, z) || solidAt(w, x + r, y + r, z)
}

function crossX(w: World, x0: number, x1: number, y: number, z: number, r: number) {
  const a = Math.floor(x0)
  const b = Math.floor(x1)
  if (a === b) return false
  const edgeX = Math.max(a, b)
  return edgeBlocks(edgeW(w, edgeX, y - r, z)) || edgeBlocks(edgeW(w, edgeX, y + r, z))
}

function crossY(w: World, y0: number, y1: number, x: number, z: number, r: number) {
  const a = Math.floor(y0)
  const b = Math.floor(y1)
  if (a === b) return false
  const edgeY = Math.max(a, b)
  return edgeBlocks(edgeN(w, x - r, edgeY, z)) || edgeBlocks(edgeN(w, x + r, edgeY, z))
}

function tryStairTransition(w: World, e: Entity, ox: number, oy: number) {
  if (e.kind === 'vehicle') return
  const z = e.z || 0
  const tx0 = Math.floor(ox), ty0 = Math.floor(oy)
  const tx1 = Math.floor(e.x), ty1 = Math.floor(e.y)
  if (tx0 === tx1 && ty0 === ty1) return

  const stair = getStairs(w, tx0, ty0, z)
  if (stair != null) {
    const d = dirDelta(stair)
    if (tx1 === tx0 + d.dx && ty1 === ty0 + d.dy && z + 1 < MAX_Z) {
      if (!isSolid(w, e.x, e.y, z + 1)) {
        e.z = z + 1
        return
      }
    }
  }

  const below = z - 1
  if (below >= 0) {
    const stairBelow = getStairs(w, tx1, ty1, below)
    if (stairBelow != null) {
      const d = dirDelta(stairBelow)
      if (tx0 === tx1 + d.dx && ty0 === ty1 + d.dy) {
        e.z = below
      }
    }
  }
}

function tryMove(w: World, e: Entity, nx: number, ny: number, r = PLAYER_R) {
  const z = e.z || 0
  const ox = e.x, oy = e.y
  if (!floorBlocked(w, nx, e.y, z, r) && !crossX(w, e.x, nx, e.y, z, r)) e.x = nx
  if (!floorBlocked(w, e.x, ny, z, r) && !crossY(w, e.y, ny, e.x, z, r)) e.y = ny
  tryStairTransition(w, e, ox, oy)
}

export function applyMove(s: GameState, e: Entity, input: Input, dt: number) {
  let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0)
  if (dx && dy) { dx *= 0.707; dy *= 0.707 }
  if (!dx && !dy) return
  e.facing = Math.atan2(dy, dx)
  const body = e.vehicleId ? s.entities.get(e.vehicleId) : e
  if (!body) return
  if (e.vehicleId) body.z = 0
  const speed = e.vehicleId ? VEHICLE_SPEED : PLAYER_SPEED
  tryMove(s.world, body, body.x + dx * speed * dt, body.y + dy * speed * dt, e.vehicleId ? 0.45 : PLAYER_R)
  if (e.vehicleId) { e.x = body.x; e.y = body.y; e.z = 0 }
}

function nearest(s: GameState, e: Entity, kind: Entity['kind'], range: number) {
  let best: Entity = null
  let bestD = range * range
  const ez = e.z || 0
  for (const o of s.entities.values()) {
    if (o.kind !== kind || o.id === e.id) continue
    if ((o.z || 0) !== ez) continue
    const d = (o.x - e.x) ** 2 + (o.y - e.y) ** 2
    if (d < bestD) { bestD = d; best = o }
  }
  return best
}

function pickup(s: GameState, e: Entity) {
  if (e.vehicleId) return
  if (e.inventory.length >= INV_MAX) return
  const item = nearest(s, e, 'item', PICKUP_RANGE)
  if (!item) return
  e.inventory.push({ type: item.itemType, name: item.name })
  s.entities.delete(item.id)
}

function drop(s: GameState, e: Entity) {
  if (!e.inventory.length) return
  const spec = e.inventory.pop()
  spawnItem(s, e.x + Math.cos(e.facing) * 0.8, e.y + Math.sin(e.facing) * 0.8, spec, e.z || 0)
}

function attack(s: GameState, e: Entity, now: number) {
  if (e.attackCd > 0 || e.vehicleId || e.dead) return
  e.attackCd = 0.4
  const fx = Math.cos(e.facing), fy = Math.sin(e.facing)
  const ez = e.z || 0
  for (const o of s.entities.values()) {
    if (o.kind !== 'player' || o.id === e.id || o.dead) continue
    if ((o.z || 0) !== ez) continue
    const dx = o.x - e.x, dy = o.y - e.y
    if (dx * dx + dy * dy > MELEE_RANGE * MELEE_RANGE) continue
    if (dx * fx + dy * fy < 0) continue
    o.health -= MELEE_DMG
    if (o.health <= 0) {
      o.health = 0
      o.dead = true
      o.respawnAt = now + 3000
      while (o.inventory.length) {
        const spec = o.inventory.pop()
        spawnItem(s, o.x + (Math.random() - 0.5), o.y + (Math.random() - 0.5), spec, o.z || 0)
      }
      if (o.vehicleId) {
        const v = s.entities.get(o.vehicleId)
        if (v) v.driverId = undefined
        o.vehicleId = undefined
      }
    }
  }
}

function enterExit(s: GameState, e: Entity) {
  if (e.vehicleId) {
    const v = s.entities.get(e.vehicleId)
    if (v) v.driverId = undefined
    e.vehicleId = undefined
    e.x += 1
    e.z = 0
    return
  }
  if ((e.z || 0) !== 0) return
  const v = nearest(s, e, 'vehicle', ENTER_RANGE)
  if (!v || v.driverId) return
  v.driverId = e.id
  e.vehicleId = v.id
  e.x = v.x
  e.y = v.y
  e.z = 0
}

export function applyAction(s: GameState, e: Entity, a: string, now: number) {
  if (a === 'pickup') pickup(s, e)
  else if (a === 'drop') drop(s, e)
  else if (a === 'attack') attack(s, e, now)
  else if (a === 'enter') enterExit(s, e)
}

export function respawn(s: GameState, e: Entity) {
  const cx = Math.floor(s.world.mapSize / 2)
  e.dead = false
  e.health = e.maxHealth
  e.respawnAt = undefined
  e.x = cx + 0.5
  e.y = cx + 0.5
  e.z = 0
  e.vehicleId = undefined
}

export function step(s: GameState, inputs: Map<string, Input>, dt: number, now: number) {
  for (const [id, input] of inputs) {
    const e = s.entities.get(id)
    if (!e || e.kind !== 'player') continue
    if (e.z == null) e.z = 0
    e.seq = input.seq
    if (e.attackCd > 0) e.attackCd -= dt
    if (e.dead) {
      if (e.respawnAt && now >= e.respawnAt) respawn(s, e)
      continue
    }
    applyMove(s, e, input, dt)
    for (const a of input.actions) applyAction(s, e, a, now)
  }
}

export function nearby(s: GameState, playerId: string, r = INTEREST) {
  const p = s.entities.get(playerId)
  if (!p) return []
  const r2 = r * r
  const out: Entity[] = []
  for (const e of s.entities.values()) {
    if (e.id === playerId || (e.x - p.x) ** 2 + (e.y - p.y) ** 2 < r2) out.push(e)
  }
  return out
}
