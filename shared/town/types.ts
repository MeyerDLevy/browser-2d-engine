import type { BuildingKind } from './config.ts'
import type { ClockState } from './clock.ts'
import type { Rng } from './rng.ts'
import type { World } from '../world.ts'

export type Vec = { x: number; y: number; z?: number }

export type Ad = {
  id: string
  building_id?: string
  score: number
  restock_item?: string
  order_item?: string
  target_store?: string
  target_item?: string
  target_qty?: number
  genre?: string
  tick_effects?: Record<string, number>
}

export type PendingOrder = { item: string; qty: number }

export type RelMemory = { day: number; tag: string; delta: number }

export type RelRecord = {
  opinion: number
  romance: number
  interactions: number
  last_day: number
  memories: RelMemory[]
  is_ex: boolean
}

export type SimBuilding = {
  buildingId: string
  kind: BuildingKind
  displayName: string
  jobSlots: number
  managerSlots: number
  shiftSlots: Record<string, number>
  shelfItems: Record<string, number>
  backroomItems: Record<string, number>
  workersOnShift: string[]
  shelfStock: Record<string, number>
  backroomStock: Record<string, number>
  activeLoans: Record<string, number>
  managerId: string
  hiringOpen: boolean
  pendingOrders: PendingOrder[]
  anchors: Record<string, Vec>
  ox: number
  oy: number
  w: number
  h: number
}

export type Npc = {
  id: string
  entityId: string
  npcName: string
  homeId: string
  jobId: string
  isManager: boolean
  jobRole: string
  jobShift: string
  color: string
  money: number
  bedIndex: number
  openness: number
  conscientiousness: number
  extraversion: number
  agreeableness: number
  neuroticism: number
  transcendence: number
  honesty_humility: number
  hunger: number
  energy: number
  social: number
  fun: number
  hygiene: number
  comfort: number
  aspiration: number
  meaning: number
  savings: number
  debt: number
  hasTv: boolean
  aspirationMid: string
  aspirationLong: string
  needAvg: Record<string, number>
  lovers: string[]
  exclusivePartner: string
  lastConversationDay: number
  currentAction: string
  currentStep: string
  carryingFood: boolean
  carryingStock: number
  carryingItem: string
  hasBook: boolean
  bookDueDay: number
  bookGenre: string
  activityLog: string[]
  mealsToday: number
  hoursWorkedToday: number
  lifetimeMeals: number
  lifetimeHoursWorked: number
  lastOptions: Ad[]
  x: number
  y: number
  z: number
  facing: number
  actionTimer: number
  rethinkCooldown: number
  path: Vec[]
  pathI: number
  dest: Vec
  moving: boolean
  jitter: Vec
  workingStore: string
  restockItem: string
  orderItem: string
  targetStore: string
  targetItem: string
  targetQty: number
  chatPartnerId: string
  wageAccumMinutes: number
  recipeSteps: string[]
  activeAd: Ad | null
}

export type EconomyState = {
  townCash: number
  bankCash: number
  ledgers: Record<string, number>
  dailySales: Record<string, number>
  townInToday: number
  townOutToday: number
  taxesToday: number
  lifetimeMealsCooked: number
  lifetimeServicesAttended: number
  lifetimeBooksCheckedOut: number
  lifetimeLateFeesPaid: number
  lifetimeTvsBought: number
  lifetimeLoansTaken: number
  lifetimeTaxesCollected: number
}

export type GovernmentState = {
  salesTaxRate: number
}

export type RelationshipsState = {
  relations: Record<string, Record<string, RelRecord>>
  lifetimeFriendships: number
  lifetimeRivalries: number
  lifetimeRomances: number
  lifetimeExclusives: number
  lifetimeBreakups: number
  lifetimeCohabits: number
}

export type TownLog = {
  lines: string[]
  ready: boolean
}

export type Town = {
  clock: ClockState
  rng: Rng
  world: World
  buildings: Map<string, SimBuilding>
  npcs: Npc[]
  economy: EconomyState
  government: GovernmentState
  relationships: RelationshipsState
  log: TownLog
  headless: boolean
  debug: boolean
  selectedId: string
  dailySummaries: string[]
}

export type TownHud = {
  time: string
  day: number
  hour: number
  minute: number
  weekday: string
  speed: number
  paused: boolean
  totalMoney: number
  townCash: number
  bankCash: number
  salesTax: number
  taxesToday: number
  npcCount: number
  stocks: Record<string, string>
  relationships: Record<string, number>
  debug: boolean
}

export type NpcInspect = {
  id: string
  name: string
  money: number
  savings: number
  debt: number
  hasTv: boolean
  job: string
  home: string
  traits: string
  action: string
  carrying: string
  pantry: string
  book: string
  top: string
  relations: string
  needs: Record<string, number>
  mealsToday: number
  hoursWorked: number
  log: string[]
  x: number
  y: number
}

export type NeedHist = {
  need: string
  avg: number
  counts: number[]
}
