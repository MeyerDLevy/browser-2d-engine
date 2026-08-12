import type { World } from './world.ts'

export type Item = { type: string; name: string }

export type Entity = {
  id: string
  kind: 'player' | 'item' | 'vehicle'
  x: number
  y: number
  facing: number
  name?: string
  health?: number
  maxHealth?: number
  inventory?: Item[]
  vehicleId?: string
  driverId?: string
  itemType?: string
  dead?: boolean
  respawnAt?: number
  attackCd?: number
  seq?: number
  color?: string
}

export type GameState = {
  world: World
  entities: Map<string, Entity>
  nextId: number
}

export const ITEM_TYPES = [
  { type: 'food', name: 'canned food' },
  { type: 'meds', name: 'bandage' },
  { type: 'ammo', name: 'bullets' },
  { type: 'melee', name: 'crowbar' },
]

export const ITEM_COLOR = {
  food: '#c4a35a',
  meds: '#d06060',
  ammo: '#c4c4c4',
  melee: '#8a8a8a',
}

export const PLAYER_COLORS = ['#e07040', '#40a0e0', '#50c070', '#d0c040', '#c060c0', '#40c0c0', '#e080a0', '#90e040']

export const INV_MAX = 16
export const PLAYER_SPEED = 5
export const VEHICLE_SPEED = 12
export const PLAYER_R = 0.28
export const MELEE_RANGE = 1.6
export const MELEE_DMG = 25
export const PICKUP_RANGE = 1.4
export const ENTER_RANGE = 1.8
