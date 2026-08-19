import type { Entity } from './entities.ts'
import type { MapData } from './world.ts'
import type { NeedHist, NpcInspect, TownHud } from './town/types.ts'

export type Input = {
  seq: number
  up: boolean
  down: boolean
  left: boolean
  right: boolean
  actions: string[]
}

export function emptyInput(): Input {
  return { seq: 0, up: false, down: false, left: false, right: false, actions: [] }
}

export type ClientMsg =
  | { type: 'join'; lobby: string; name: string; map?: string }
  | { type: 'input'; seq: number; up: boolean; down: boolean; left: boolean; right: boolean; actions: string[] }
  | { type: 'inspect'; targetId: string | null }
  | { type: 'sim'; speed?: number; debug?: boolean; hist?: boolean }

export type ServerMsg =
  | { type: 'welcome'; playerId: string; seed: number; mapSize: number; tick: number; lobby: string; mapData?: MapData }
  | {
    type: 'snapshot'
    tick: number
    seq: number
    entities: Entity[]
    town?: TownHud
    inspect?: NpcInspect
    hist?: NeedHist[]
    debug?: any
  }
  | { type: 'error'; message: string }
