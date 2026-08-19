import {
  BUFFER_CATCHUP, COMFORT_RATE, OPEN_SLOT_COST, SMOOTH_STEP, START_SALES_TAX,
  STRESS_PASS, TARGET_BUFFER, TAX_MAX, TAX_MIN,
} from './config.ts'
import { grossSalesToday, rosterCount, rosterCountShift } from './economy.ts'
import { clamp } from './rng.ts'
import type { GovernmentState, Town } from './types.ts'

export function makeGovernment(): GovernmentState {
  return { salesTaxRate: START_SALES_TAX }
}

export function openJobSlots(t: Town) {
  let n = 0
  for (const b of t.buildings.values()) {
    if (b.jobSlots <= 0) continue
    if (!Object.keys(b.shiftSlots).length) n += Math.max(0, b.jobSlots - rosterCount(b, t))
    else {
      for (const shift in b.shiftSlots) n += Math.max(0, b.shiftSlots[shift] - rosterCountShift(b, t, shift))
    }
  }
  return n
}

export function mayor(t: Town) {
  return t.npcs.find(n => t.buildings.get(n.jobId)?.kind === 'town_hall') || null
}

export function reviewPolicies(t: Town) {
  const open = openJobSlots(t)
  const gross = grossSalesToday(t.economy)
  const net = t.economy.townOutToday - t.economy.townInToday
  let needed = open * OPEN_SLOT_COST
  if (t.economy.townCash < TARGET_BUFFER) needed += Math.min(BUFFER_CATCHUP, TARGET_BUFFER - t.economy.townCash)
  if (net > 0) needed += Math.min(30, net * 0.05)
  const raw = needed / Math.max(1, gross)
  let target = COMFORT_RATE
  if (raw > COMFORT_RATE) target = COMFORT_RATE + (raw - COMFORT_RATE) * STRESS_PASS
  target = clamp(target, TAX_MIN, TAX_MAX)
  if (target > t.government.salesTaxRate) t.government.salesTaxRate = Math.min(t.government.salesTaxRate + SMOOTH_STEP, target)
  else t.government.salesTaxRate = Math.max(t.government.salesTaxRate - SMOOTH_STEP, target)
  const m = mayor(t)
  if (m) {
    m.activityLog.push(
      `set sales tax to ${(t.government.salesTaxRate * 100).toFixed(0)}% — ${open} open jobs, town short $${needed.toFixed(0)}, sales $${gross.toFixed(0)}`,
    )
  }
}
