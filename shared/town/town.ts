import type { Entity, GameState } from '../entities.ts'
import { finishDay, onDayPassed, totalMoney } from './economy.ts'
import { reviewPolicies } from './government.ts'
import { onRelDayPassed, relCounts, snapshotFor } from './relationships.ts'
import { timeString, tickMinute, weekdayName } from './clock.ts'
import { onNpcMinute, walkNpc } from './npc.ts'
import { createTown } from './generate.ts'
import { traitSummary } from './personality.ts'
import type { NeedHist, Npc, NpcInspect, Town, TownHud } from './types.ts'
import type { SimSite } from '../buildings.ts'

export function attachTown(s: GameState, sites?: SimSite[]) {
  const town = createTown(s.world, sites)
  s.town = town
  for (const npc of town.npcs) {
    const e: Entity = {
      id: 'n' + s.nextId++,
      kind: 'npc',
      x: npc.x,
      y: npc.y,
      z: npc.z,
      facing: npc.facing,
      name: npc.npcName,
      color: npc.color,
      npcAction: npc.currentAction,
      homeId: npc.homeId,
      jobId: npc.jobId,
    }
    npc.entityId = e.id
    s.entities.set(e.id, e)
  }
  return town
}

export function syncNpcEntity(s: GameState, npc: Npc) {
  const e = s.entities.get(npc.entityId)
  if (!e) return
  e.x = npc.x
  e.y = npc.y
  e.z = npc.z
  e.facing = npc.facing
  e.npcAction = npc.currentAction
  e.homeId = npc.homeId
  e.jobId = npc.jobId
  e.name = npc.npcName
  e.color = npc.color
}

export function stepTown(s: GameState, dt: number) {
  const t = s.town
  if (!t) return
  if (t.clock.speed > 0) {
    const rate = t.clock.minutesPerRealSecond * t.clock.speed
    t.clock.accum += dt * rate
    while (t.clock.accum >= 1) {
      t.clock.accum -= 1
      const { dayPassed } = tickMinute(t.clock)
      for (const npc of t.npcs) onNpcMinute(t, npc)
      if (dayPassed) {
        onDayPassed(t)
        reviewPolicies(t)
        finishDay(t)
        onRelDayPassed(t)
      }
    }
  }
  for (const npc of t.npcs) {
    walkNpc(t, npc, dt)
    syncNpcEntity(s, npc)
  }
}

export function advanceTownMinutes(s: GameState, n: number) {
  const t = s.town
  if (!t) return
  for (let i = 0; i < n; i++) {
    const { dayPassed } = tickMinute(t.clock)
    for (const npc of t.npcs) onNpcMinute(t, npc)
    if (dayPassed) {
      onDayPassed(t)
      reviewPolicies(t)
      finishDay(t)
      onRelDayPassed(t)
    }
  }
  for (const npc of t.npcs) syncNpcEntity(s, npc)
}

function stockLine(t: Town, kind: string, item: string, back = false) {
  let n = 0, b = 0
  for (const x of t.buildings.values()) {
    if (x.kind !== kind) continue
    n += x.shelfStock[item] || 0
    b += x.backroomStock[item] || 0
  }
  return back ? `${n}/${b}` : String(n)
}

function kindCash(t: Town, kind: string) {
  let s = 0
  for (const b of t.buildings.values()) if (b.kind === kind) s += t.economy.ledgers[b.buildingId] || 0
  return s
}

export function townHud(t: Town): TownHud {
  const rc = relCounts(t)
  return {
    time: timeString(t.clock),
    day: t.clock.day,
    hour: t.clock.hour,
    minute: t.clock.minute,
    weekday: weekdayName(t.clock),
    speed: t.clock.speed,
    paused: t.clock.speed <= 0,
    totalMoney: totalMoney(t),
    townCash: t.economy.townCash,
    bankCash: t.economy.bankCash,
    salesTax: t.government.salesTaxRate,
    taxesToday: t.economy.taxesToday,
    npcCount: t.npcs.length,
    stocks: {
      gas: stockLine(t, 'gas_station', 'snack', true),
      grocerySnack: stockLine(t, 'grocery', 'snack', true),
      groceryUncooked: stockLine(t, 'grocery', 'uncooked', true),
      books: stockLine(t, 'library', 'book'),
      warehouse: kindCash(t, 'warehouse').toFixed(0),
      bar: kindCash(t, 'bar').toFixed(0),
      church: kindCash(t, 'church').toFixed(0),
      library: kindCash(t, 'library').toFixed(0),
    },
    relationships: rc,
    debug: t.debug,
  }
}

export function inspectNpc(t: Town, npc: Npc): NpcInspect {
  let job = npc.jobId || '(unemployed)'
  if (npc.isManager) job += ' (manager)'
  else if (npc.jobRole) job += ` (${npc.jobRole})`
  let action = npc.currentAction
  if (npc.currentStep) action += ' (' + npc.currentStep + ')'
  const home = t.buildings.get(npc.homeId)
  const pantry = home ? `pantry: ${home.shelfStock.uncooked || 0} uncooked / ${home.shelfStock.meal || 0} meals` : ''
  const book = npc.hasBook ? `has ${npc.bookGenre} book (due day ${npc.bookDueDay})` : 'no book'
  const top = npc.lastOptions.map(o => {
    let label = o.id
    if (o.genre) label += '/' + o.genre
    return `${label} ${o.score.toFixed(1)}`
  }).join('  |  ') || '(none yet)'
  const rel = snapshotFor(t, npc)
  let relations = `partner: ${rel.exclusive_partner || '-'}\nlovers: ${rel.lovers.join(', ') || '-'}\nfriends: ${rel.friends.join(', ') || '-'}\nrivals: ${rel.rivals.join(', ') || '-'}\n`
  for (const row of rel.top_opinions) relations += `  ${row.name} ${row.opinion >= 0 ? '+' : ''}${row.opinion.toFixed(0)} (${row.label})\n`
  for (const row of rel.low_opinions) {
    if (row.opinion >= 0) continue
    relations += `  ${row.name} ${row.opinion.toFixed(0)} (${row.label})\n`
  }
  const carrying = npc.carryingFood ? 'food' : (npc.carryingStock > 0 ? `${npc.carryingStock} ${npc.carryingItem}` : 'nothing')
  return {
    id: npc.entityId || npc.id,
    name: npc.npcName,
    money: npc.money,
    savings: npc.savings,
    debt: npc.debt,
    hasTv: npc.hasTv,
    job, home: npc.homeId, traits: traitSummary(npc), action, carrying, pantry, book, top, relations,
    needs: {
      hunger: npc.hunger, energy: npc.energy, social: npc.social, fun: npc.fun,
      hygiene: npc.hygiene, comfort: npc.comfort, aspiration: npc.aspiration, meaning: npc.meaning,
    },
    mealsToday: npc.mealsToday,
    hoursWorked: npc.hoursWorkedToday,
    log: npc.activityLog.slice(-8),
    x: npc.x, y: npc.y,
  }
}

export function needHistograms(t: Town): NeedHist[] {
  const needs = ['hunger', 'energy', 'social', 'fun', 'hygiene', 'comfort', 'aspiration', 'meaning']
  return needs.map(need => {
    const counts = Array(10).fill(0)
    let sum = 0
    for (const n of t.npcs) {
      const v = (n as any)[need] as number
      sum += v
      counts[Math.max(0, Math.min(9, Math.floor(v / 10)))]++
    }
    return { need, avg: t.npcs.length ? sum / t.npcs.length : 0, counts }
  })
}

export function debugOverlays(t: Town) {
  return {
    buildings: [...t.buildings.values()].map(b => ({
      id: b.buildingId, kind: b.kind, ox: b.ox, oy: b.oy, w: b.w, h: b.h,
      anchors: b.anchors, hiring: b.hiringOpen, stock: b.shelfStock, back: b.backroomStock,
      ledger: t.economy.ledgers[b.buildingId] || 0, jobs: b.jobSlots, manager: b.managerId,
    })),
    paths: t.npcs.map(n => ({
      id: n.entityId || n.id, name: n.npcName, action: n.currentAction,
      dest: n.dest, path: n.path, x: n.x, y: n.y,
    })),
  }
}

export function findNpcByEntity(t: Town, entityId: string) {
  return t.npcs.find(n => n.entityId === entityId || n.id === entityId) || null
}

export function setTownSpeed(t: Town, speed: number) {
  t.clock.speed = speed
}
