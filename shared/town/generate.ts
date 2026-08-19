import {
  BUILDING_SPECS, FIRST_NAMES, HOUSE_SHELF, NPC_COLORS, PERSONALITY_SEED, WAREHOUSE_ROLES,
  type BuildingKind,
} from './config.ts'
import { makeClock } from './clock.ts'
import { initLedger, makeEconomy } from './economy.ts'
import { makeGovernment } from './government.ts'
import { makeRelationships } from './relationships.ts'
import { dream } from './aspirations.ts'
import { rollPersonality } from './personality.ts'
import { makeRng } from './rng.ts'
import type { Npc, SimBuilding, Town } from './types.ts'
import type { SimSite } from '../buildings.ts'
import type { World } from '../world.ts'

function makeBuilding(id: string, site: SimSite): SimBuilding {
  const kind = site.kind
  const spec = kind === 'house' ? null : BUILDING_SPECS[kind]
  const shelf = kind === 'house' ? { ...HOUSE_SHELF } : { ...(spec?.shelf || {}) }
  const back = spec ? { ...spec.backroom } : {}
  const shelfStock: Record<string, number> = {}
  const backroomStock: Record<string, number> = {}
  for (const k in shelf) shelfStock[k] = shelf[k]
  for (const k in back) backroomStock[k] = back[k]
  return {
    buildingId: id,
    kind,
    displayName: kind === 'house' ? id.replace('_', ' ') : (spec?.display || kind),
    jobSlots: spec?.jobs || 0,
    managerSlots: spec?.managers || 0,
    shiftSlots: { ...(spec?.shifts || {}) },
    shelfItems: shelf,
    backroomItems: back,
    workersOnShift: [],
    shelfStock,
    backroomStock,
    activeLoans: {},
    managerId: '',
    hiringOpen: false,
    pendingOrders: [],
    anchors: site.anchors,
    ox: site.ox,
    oy: site.oy,
    w: site.w,
    h: site.h,
  }
}

function makeNpc(id: string, name: string, homeId: string, color: string): Npc {
  return {
    id, entityId: '', npcName: name, homeId, jobId: '', isManager: false, jobRole: '', jobShift: 'day',
    color, money: 100, bedIndex: 0,
    openness: 0, conscientiousness: 0, extraversion: 0, agreeableness: 0,
    neuroticism: 0, transcendence: 0, honesty_humility: 0,
    hunger: 80, energy: 80, social: 70, fun: 70, hygiene: 80, comfort: 80, aspiration: 60, meaning: 60,
    savings: 0, debt: 0, hasTv: false, aspirationMid: '', aspirationLong: '', needAvg: {},
    lovers: [], exclusivePartner: '', lastConversationDay: -1,
    currentAction: 'idle', currentStep: '', carryingFood: false, carryingStock: 0, carryingItem: '',
    hasBook: false, bookDueDay: -1, bookGenre: '', activityLog: [],
    mealsToday: 0, hoursWorkedToday: 0, lifetimeMeals: 0, lifetimeHoursWorked: 0, lastOptions: [],
    x: 0, y: 0, z: 0, facing: 0, actionTimer: 0, rethinkCooldown: 0,
    path: [], pathI: 0, dest: { x: 0, y: 0 }, moving: false, jitter: { x: 0, y: 0 },
    workingStore: '', restockItem: '', orderItem: '', targetStore: '', targetItem: '', targetQty: 0,
    chatPartnerId: '', wageAccumMinutes: 0, recipeSteps: [], activeAd: null,
  }
}

function uniqueName(used: Set<string>, base: string, i: number) {
  let n = base
  if (used.has(n)) n = base + (i + 1)
  let k = 2
  while (used.has(n)) n = base + k++
  used.add(n)
  return n
}

export function createTown(world: World, sites?: SimSite[]): Town {
  const t: Town = {
    clock: makeClock(),
    rng: makeRng(world.seed ^ PERSONALITY_SEED),
    world,
    buildings: new Map(),
    npcs: [],
    economy: makeEconomy(),
    government: makeGovernment(),
    relationships: makeRelationships(),
    log: { lines: [], ready: false },
    headless: false,
    debug: false,
    selectedId: '',
    dailySummaries: [],
  }
  const use = (sites || world.sites || []).filter(s => s && s.sim)
  const counts: Record<string, number> = {}
  const houses: SimBuilding[] = []
  const jobs: SimBuilding[] = []
  for (const site of use) {
    counts[site.kind] = (counts[site.kind] || 0) + 1
    const id = site.kind + '_' + (counts[site.kind] - 1)
    const b = makeBuilding(id, site)
    t.buildings.set(id, b)
    initLedger(t.economy, id, site.kind)
    if (site.kind === 'house') houses.push(b)
    else jobs.push(b)
  }
  if (!houses.length) return t

  const used = new Set<string>()
  const beds: Record<string, number> = {}
  const unemployed: Npc[] = []
  let ni = 0

  function spawnAt(home: SimBuilding, money: number) {
    const name = uniqueName(used, FIRST_NAMES[ni % FIRST_NAMES.length], ni)
    const npc = makeNpc('n' + ni, name, home.buildingId, NPC_COLORS[ni % NPC_COLORS.length])
    npc.money = money
    npc.bedIndex = beds[home.buildingId] || 0
    beds[home.buildingId] = npc.bedIndex + 1
    rollPersonality(npc, t.rng)
    npc.rethinkCooldown = t.rng.rand() * 5
    npc.jitter = { x: t.rng.randfRange(-0.25, 0.25), y: t.rng.randfRange(-0.25, 0.25) }
    const door = home.anchors.door
    npc.x = door.x + t.rng.randfRange(-0.6, 0.6)
    npc.y = door.y + 0.6 + ni * 0.02
    npc.dest = { x: npc.x, y: npc.y }
    t.npcs.push(npc)
    ni++
    return npc
  }

  const homeFor = (i: number) => houses[i % houses.length]

  for (const b of jobs) {
    if (b.kind === 'town_hall') {
      const n = spawnAt(homeFor(ni), 150)
      n.jobId = b.buildingId
      n.isManager = true
      n.jobRole = 'mayor'
      b.managerId = n.npcName
      continue
    }
    const roles = b.kind === 'warehouse' ? [...WAREHOUSE_ROLES] : []
    const shifts: string[] = []
    if (b.shiftSlots.day) for (let i = 0; i < b.shiftSlots.day; i++) shifts.push('day')
    if (b.shiftSlots.night) for (let i = 0; i < b.shiftSlots.night; i++) shifts.push('night')
    const nJobs = Math.max(b.jobSlots, b.managerSlots)
    for (let i = 0; i < nJobs; i++) {
      const n = spawnAt(homeFor(ni), 90 + t.rng.randi(90))
      n.jobId = b.buildingId
      if (i === 0 && b.managerSlots > 0) {
        n.isManager = true
        b.managerId = n.npcName
      }
      if (roles.length) n.jobRole = roles.shift()
      if (shifts.length) n.jobShift = shifts.shift()
    }
  }

  for (const h of houses) {
    const taken = beds[h.buildingId] || 0
    const want = taken === 0 ? 1 + (t.rng.randi(2) ? 1 : 0) : Math.min(2, taken + (taken < 2 && t.rng.chance(0.4) ? 1 : 0))
    while ((beds[h.buildingId] || 0) < want && (beds[h.buildingId] || 0) < 2) {
      unemployed.push(spawnAt(h, 90 + t.rng.randi(40)))
    }
  }

  for (const n of t.npcs) dream(t, n, true)
  return t
}
