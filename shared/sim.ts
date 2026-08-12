import { INTEREST, getTile, hash, isSolid, ROAD } from './world.ts'
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

export function createGame(seed: number, mapSize: number): GameState {
  const world: World = { seed, mapSize, overrides: new Map() }
  const s: GameState = { world, entities: new Map(), nextId: 1 }
  const cx = Math.floor(mapSize / 2)
  const cy = Math.floor(mapSize / 2)
  for (let i = 0; i < 80; i++) {
    let x = cx + (hash(i, 1, seed) % 200) - 100
    let y = cy + (hash(i, 2, seed) % 200) - 100
    if (getTile(world, x, y) !== ROAD) {
      x = cx + (i % 20) - 10
      y = cy
    }
    const spec = ITEM_TYPES[i % ITEM_TYPES.length]
    spawnItem(s, x + 0.5, y + 0.5, spec)
  }
  for (let i = 0; i < 8; i++) spawnVehicle(s, cx + 2 + i * 3 + 0.5, cy + 0.5)
  return s
}

export function spawnItem(s: GameState, x: number, y: number, spec: Item) {
  const e: Entity = {
    id: nid(s, 'i'), kind: 'item', x, y, facing: 0,
    itemType: spec.type, name: spec.name,
  }
  s.entities.set(e.id, e)
  return e
}

export function spawnVehicle(s: GameState, x: number, y: number) {
  const e: Entity = { id: nid(s, 'v'), kind: 'vehicle', x, y, facing: 0, name: 'car' }
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

function tryMove(w: World, e: Entity, nx: number, ny: number, r = PLAYER_R) {
  const blocked = (x: number, y: number) =>
    isSolid(w, x - r, y - r) || isSolid(w, x + r, y - r) ||
    isSolid(w, x - r, y + r) || isSolid(w, x + r, y + r)
  if (!blocked(nx, ny)) { e.x = nx; e.y = ny; return }
  if (!blocked(nx, e.y)) { e.x = nx; return }
  if (!blocked(e.x, ny)) { e.y = ny; return }
}

export function applyMove(s: GameState, e: Entity, input: Input, dt: number) {
  let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0)
  if (dx && dy) { dx *= 0.707; dy *= 0.707 }
  if (!dx && !dy) return
  e.facing = Math.atan2(dy, dx)
  const body = e.vehicleId ? s.entities.get(e.vehicleId) : e
  if (!body) return
  const speed = e.vehicleId ? VEHICLE_SPEED : PLAYER_SPEED
  tryMove(s.world, body, body.x + dx * speed * dt, body.y + dy * speed * dt, e.vehicleId ? 0.45 : PLAYER_R)
  if (e.vehicleId) { e.x = body.x; e.y = body.y }
}

function nearest(s: GameState, e: Entity, kind: Entity['kind'], range: number) {
  let best: Entity = null
  let bestD = range * range
  for (const o of s.entities.values()) {
    if (o.kind !== kind || o.id === e.id) continue
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
  spawnItem(s, e.x + Math.cos(e.facing) * 0.8, e.y + Math.sin(e.facing) * 0.8, spec)
}

function attack(s: GameState, e: Entity, now: number) {
  if (e.attackCd > 0 || e.vehicleId || e.dead) return
  e.attackCd = 0.4
  const fx = Math.cos(e.facing), fy = Math.sin(e.facing)
  for (const o of s.entities.values()) {
    if (o.kind !== 'player' || o.id === e.id || o.dead) continue
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
        spawnItem(s, o.x + (Math.random() - 0.5), o.y + (Math.random() - 0.5), spec)
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
    return
  }
  const v = nearest(s, e, 'vehicle', ENTER_RANGE)
  if (!v || v.driverId) return
  v.driverId = e.id
  e.vehicleId = v.id
  e.x = v.x
  e.y = v.y
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
  e.vehicleId = undefined
}

export function step(s: GameState, inputs: Map<string, Input>, dt: number, now: number) {
  for (const [id, input] of inputs) {
    const e = s.entities.get(id)
    if (!e || e.kind !== 'player') continue
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
