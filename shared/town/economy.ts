import {
  ASPIRATION_RAID_PENALTY, BANK_INTEREST, BANK_REPAY_PER_DAY, BAR_DRINK,
  BEDS_PER_HOUSE, COOK_BATCH_MEALS, DECAY_ASPIRATION, LATE_FEE_PER_DAY, LOAN_AMOUNT,
  LOAN_DAYS, LOG_HEADER, MANAGER_WAGE_MULT, MEDICAL_BILL_AMOUNT, MEDICAL_BILL_CHANCE,
  MEAL_HUNGER_RESTORE, ODD_JOB_PAY, ORDER_PRICE, QUIT_CHANCE, QUIT_MONEY_THRESHOLD,
  RENT_PER_HOUSE, SAVINGS_RATE_DEFAULT, SNACK_GAS, SNACK_GROCERY, START_BANK_CASH,
  START_LEDGERS, START_TOWN_CASH, TV_LIFETIME_VALUE, TV_PRICE, UNCOOKED_PRICE,
  UTILITY_PER_HOUSE, WAGES,
} from './config.ts'
import { savingsRateBonus } from './aspirations.ts'
import { aspirationMult, impulsivityK, willOverspend } from './personality.ts'
import type { EconomyState, Npc, SimBuilding, Town } from './types.ts'

export function makeEconomy(): EconomyState {
  return {
    townCash: START_TOWN_CASH,
    bankCash: START_BANK_CASH,
    ledgers: {},
    dailySales: {},
    townInToday: 0,
    townOutToday: 0,
    taxesToday: 0,
    lifetimeMealsCooked: 0,
    lifetimeServicesAttended: 0,
    lifetimeBooksCheckedOut: 0,
    lifetimeLateFeesPaid: 0,
    lifetimeTvsBought: 0,
    lifetimeLoansTaken: 0,
    lifetimeTaxesCollected: 0,
  }
}

export function initLedger(e: EconomyState, id: string, kind: string) {
  e.ledgers[id] = START_LEDGERS[kind] ?? 0
}

export function savingsRate(npc: Npc) {
  return SAVINGS_RATE_DEFAULT + savingsRateBonus(npc)
}

export function recordSale(e: EconomyState, storeId: string, amount: number) {
  e.dailySales[storeId] = (e.dailySales[storeId] || 0) + amount
}

export function grossSalesToday(e: EconomyState) {
  let t = 0
  for (const v of Object.values(e.dailySales)) t += v
  return t
}

export function totalMoney(t: Town) {
  let n = t.economy.townCash + t.economy.bankCash
  for (const v of Object.values(t.economy.ledgers)) n += v
  for (const npc of t.npcs) n += npc.money + npc.savings
  return n
}

export function routePaycheck(npc: Npc, gross: number) {
  const cut = gross * savingsRate(npc)
  npc.savings += cut
  npc.aspiration = Math.min(100, npc.aspiration + cut * 0.15 * aspirationMult(npc))
  return gross - cut
}

export function estimateDaysToAfford(npc: Npc) {
  const need = TV_PRICE - npc.savings
  if (need <= 0) return 0
  return need / Math.max(1, 20 * savingsRate(npc))
}

export function tvUtility(npc: Npc) {
  return TV_LIFETIME_VALUE / (1 + impulsivityK(npc) * estimateDaysToAfford(npc))
}

export function snackPrice(storeKind: string) {
  return storeKind === 'gas_station' ? SNACK_GAS : SNACK_GROCERY
}

export function buyTv(t: Town, npc: Npc, storeId: string) {
  if (npc.hasTv || npc.savings < TV_PRICE) return false
  npc.savings -= TV_PRICE
  t.economy.ledgers[storeId] = (t.economy.ledgers[storeId] || 0) + TV_PRICE
  recordSale(t.economy, storeId, TV_PRICE)
  npc.hasTv = true
  npc.aspiration = 100
  t.economy.lifetimeTvsBought += 1
  return true
}

export function takeLoan(t: Town, npc: Npc, amount: number) {
  npc.money += amount
  npc.debt += amount * (1 + BANK_INTEREST)
  t.economy.bankCash -= amount
  t.economy.lifetimeLoansTaken += 1
  npc.activityLog.push(`took a $${amount.toFixed(0)} loan (debt now $${npc.debt.toFixed(1)})`)
}

function raidSavings(npc: Npc, amount: number) {
  const took = Math.min(npc.savings, amount)
  npc.savings -= took
  npc.money += took
  if (took > 0) {
    npc.aspiration = Math.max(0, npc.aspiration - ASPIRATION_RAID_PENALTY)
    npc.activityLog.push(`raided $${took.toFixed(1)} from savings`)
  }
  return took
}

export function buySnack(t: Town, npc: Npc, store: SimBuilding) {
  const price = snackPrice(store.kind)
  if (npc.money < price) return false
  npc.money -= price
  t.economy.ledgers[store.buildingId] = (t.economy.ledgers[store.buildingId] || 0) + price
  recordSale(t.economy, store.buildingId, price)
  npc.mealsToday += 1
  npc.lifetimeMeals += 1
  return true
}

export function buyUncooked(t: Town, npc: Npc, grocery: SimBuilding, qty: number) {
  const affordable = Math.floor(npc.money / UNCOOKED_PRICE)
  const available = grocery.shelfStock.uncooked || 0
  const n = Math.min(qty, affordable, available)
  if (n <= 0) return 0
  npc.money -= n * UNCOOKED_PRICE
  t.economy.ledgers[grocery.buildingId] = (t.economy.ledgers[grocery.buildingId] || 0) + n * UNCOOKED_PRICE
  recordSale(t.economy, grocery.buildingId, n * UNCOOKED_PRICE)
  takeItem(grocery, 'uncooked', n)
  return n
}

export function eatHomeMeal(t: Town, npc: Npc, home: SimBuilding) {
  if ((home.shelfStock.meal || 0) <= 0) return false
  takeItem(home, 'meal', 1)
  npc.hunger = Math.min(100, npc.hunger + MEAL_HUNGER_RESTORE)
  npc.mealsToday += 1
  npc.lifetimeMeals += 1
  return true
}

export function payBarTab(t: Town, npc: Npc, bar: SimBuilding) {
  if (npc.money < BAR_DRINK) {
    if (!willOverspend(npc)) return false
    raidSavings(npc, BAR_DRINK - npc.money)
    if (npc.money < BAR_DRINK) takeLoan(t, npc, LOAN_AMOUNT)
    if (npc.money < BAR_DRINK) return false
  }
  npc.money -= BAR_DRINK
  t.economy.ledgers[bar.buildingId] = (t.economy.ledgers[bar.buildingId] || 0) + BAR_DRINK
  recordSale(t.economy, bar.buildingId, BAR_DRINK)
  npc.fun = Math.min(100, npc.fun + 40)
  npc.social = Math.min(100, npc.social + 35)
  return true
}

export function checkoutBook(t: Town, npc: Npc, library: SimBuilding) {
  npc.hasBook = true
  npc.bookDueDay = t.clock.day + LOAN_DAYS
  library.activeLoans[npc.npcName] = npc.bookDueDay
  t.economy.lifetimeBooksCheckedOut += 1
  return true
}

export function returnBook(t: Town, npc: Npc, library: SimBuilding) {
  if (!npc.hasBook) return false
  const due = library.activeLoans[npc.npcName] ?? -1
  delete library.activeLoans[npc.npcName]
  const daysLate = due < 0 ? 0 : Math.max(0, t.clock.day - due)
  const fee = daysLate * LATE_FEE_PER_DAY
  const paid = Math.min(npc.money, fee)
  npc.money -= paid
  t.economy.ledgers[library.buildingId] = (t.economy.ledgers[library.buildingId] || 0) + paid
  if (paid > 0) recordSale(t.economy, library.buildingId, paid)
  t.economy.lifetimeLateFeesPaid += paid
  addToShelf(library, 'book', 1)
  npc.hasBook = false
  npc.bookDueDay = -1
  return true
}

export function payWage(t: Town, npc: Npc, storeId: string, hours: number) {
  const store = t.buildings.get(storeId)
  let rate = WAGES[store?.kind || storeId] || ODD_JOB_PAY
  if (npc.isManager) rate *= MANAGER_WAGE_MULT
  const pay = rate * hours
  const cash = t.economy.ledgers[storeId] || 0
  if (cash < pay) {
    t.economy.townCash -= pay - cash
    t.economy.townOutToday += pay - cash
    t.economy.ledgers[storeId] = 0
  } else {
    t.economy.ledgers[storeId] = cash - pay
  }
  npc.money += routePaycheck(npc, pay)
  npc.hoursWorkedToday += hours
  npc.lifetimeHoursWorked += hours
}

export function orderStock(t: Town, building: SimBuilding, item: string) {
  const cap = building.backroomItems[item] || 0
  if (cap <= 0) return 0
  const have = (building.backroomStock[item] || 0) + pendingQty(building, item)
  const want = cap - have
  if (want <= 0) return 0
  const unit = ORDER_PRICE[item] || 0
  if (unit <= 0) return 0
  const cost = want * unit
  const cash = t.economy.ledgers[building.buildingId] || 0
  const paid = Math.min(cash, cost)
  t.economy.ledgers[building.buildingId] = cash - paid
  const wh = [...t.buildings.values()].find(b => b.kind === 'warehouse')
  if (wh) t.economy.ledgers[wh.buildingId] = (t.economy.ledgers[wh.buildingId] || 0) + paid
  building.pendingOrders.push({ item, qty: want })
  return want
}

export function payOddJob(t: Town, npc: Npc, hours: number) {
  const pay = ODD_JOB_PAY * hours
  t.economy.townCash -= pay
  t.economy.townOutToday += pay
  npc.money += routePaycheck(npc, pay)
  npc.hoursWorkedToday += hours
  npc.lifetimeHoursWorked += hours
}

export function residentsOf(t: Town, homeId: string) {
  return t.npcs.filter(n => n.homeId === homeId)
}

export function openBeds(t: Town, homeId: string) {
  return Math.max(0, BEDS_PER_HOUSE - residentsOf(t, homeId).length)
}

export function reassignBeds(t: Town, homeId: string) {
  let i = 0
  for (const n of residentsOf(t, homeId)) {
    n.bedIndex = Math.min(i, BEDS_PER_HOUSE - 1)
    i++
  }
}

function collectHouseBill(t: Town, amount: number, label: string) {
  const byHome: Record<string, Npc[]> = {}
  for (const n of t.npcs) {
    if (!n.homeId) continue
    ;(byHome[n.homeId] ||= []).push(n)
  }
  for (const homeId in byHome) {
    const residents = byHome[homeId]
    const share = amount / residents.length
    for (const n of residents) {
      const paid = Math.min(n.money, share)
      n.money -= paid
      t.economy.townCash += paid
      t.economy.townInToday += paid
      if (paid < share - 0.01) n.activityLog.push(`couldn't fully pay ${label} (short $${(share - paid).toFixed(1)})`)
    }
  }
}

function settleSalesTax(t: Town) {
  t.economy.taxesToday = 0
  const rate = t.government.salesTaxRate
  for (const storeId of Object.keys(t.economy.dailySales)) {
    const sales = t.economy.dailySales[storeId]
    if (sales <= 0) continue
    const cash = t.economy.ledgers[storeId] || 0
    const tax = Math.min(rate * sales, Math.max(0, cash))
    if (tax <= 0) continue
    t.economy.ledgers[storeId] = cash - tax
    t.economy.townCash += tax
    t.economy.taxesToday += tax
    t.economy.lifetimeTaxesCollected += tax
    const b = t.buildings.get(storeId)
    if (b?.managerId) {
      const m = t.npcs.find(n => n.npcName === b.managerId)
      if (m) m.activityLog.push(`paid $${tax.toFixed(1)} sales tax (${(rate * 100).toFixed(0)}% of $${sales.toFixed(0)} sales)`)
    }
  }
}

function collectLoanPayments(t: Town) {
  for (const n of t.npcs) {
    if (n.debt <= 0) continue
    const due = Math.min(BANK_REPAY_PER_DAY, n.debt)
    const paid = Math.min(n.money, due)
    n.money -= paid
    n.debt -= paid
    t.economy.bankCash += paid
    if (paid < due - 0.01) n.activityLog.push(`missed loan payment (short $${(due - paid).toFixed(1)})`)
  }
}

function maybeMedicalBill(t: Town) {
  for (const n of t.npcs) {
    if (!t.rng.chance(MEDICAL_BILL_CHANCE)) continue
    let bill = MEDICAL_BILL_AMOUNT
    const fromSavings = Math.min(n.savings, bill)
    n.savings -= fromSavings
    bill -= fromSavings
    const fromMoney = Math.min(n.money, bill)
    n.money -= fromMoney
    t.economy.townCash += fromSavings + fromMoney
    t.economy.townInToday += fromSavings + fromMoney
    n.aspiration = Math.max(0, n.aspiration - ASPIRATION_RAID_PENALTY)
    n.activityLog.push(`medical bill $${MEDICAL_BILL_AMOUNT.toFixed(0)} (savings-$${fromSavings.toFixed(1)} cash-$${fromMoney.toFixed(1)})`)
  }
}

function checkTurnover(t: Town) {
  for (const n of t.npcs) {
    if (!n.jobId || n.money >= QUIT_MONEY_THRESHOLD) continue
    if (!t.rng.chance(QUIT_CHANCE)) continue
    const b = t.buildings.get(n.jobId)
    n.activityLog.push(`quit job at ${n.jobId} (broke)`)
    if (b && b.managerId === n.npcName) b.managerId = ''
    n.isManager = false
    n.jobId = ''
  }
}

export function fmt(v: any) {
  return typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : String(v)
}

function kindCash(t: Town, kind: string) {
  let s = 0
  for (const b of t.buildings.values()) if (b.kind === kind) s += t.economy.ledgers[b.buildingId] || 0
  return s
}

function kindStock(t: Town, kind: string, item: string, back = false) {
  let n = 0
  for (const b of t.buildings.values()) {
    if (b.kind !== kind) continue
    n += back ? (b.backroomStock[item] || 0) : (b.shelfStock[item] || 0)
  }
  return n
}

export function writeDailyLog(t: Town) {
  if (!t.log.ready) {
    t.log.lines.push(LOG_HEADER)
    t.log.ready = true
  }
  const e = t.economy
  const total = totalMoney(t)
  const shared = [
    e.townCash, e.bankCash, kindCash(t, 'gas_station'), kindCash(t, 'grocery'),
    kindCash(t, 'bar'), kindCash(t, 'church'), kindCash(t, 'library'), kindCash(t, 'big_box'),
    kindStock(t, 'gas_station', 'snack'), kindStock(t, 'gas_station', 'snack', true),
    kindStock(t, 'grocery', 'snack'), kindStock(t, 'grocery', 'uncooked'),
    kindStock(t, 'grocery', 'snack', true), kindStock(t, 'grocery', 'uncooked', true),
    kindStock(t, 'library', 'book'), total, t.government.salesTaxRate, e.taxesToday,
  ]
  for (const n of t.npcs) {
    t.log.lines.push([
      t.clock.day - 1, 'npc', n.npcName, n.money, n.savings, n.aspiration, n.debt, n.hasTv ? 1 : 0,
      n.hunger, n.energy, n.social, n.fun, n.mealsToday, n.hoursWorkedToday, n.currentAction,
      ...shared,
    ].map(fmt).join(','))
  }
  t.log.lines.push([
    t.clock.day - 1, 'ledger', 'town', e.townCash, '', '', '', '', '', '', '', '', '', '', '',
    ...shared,
  ].map(fmt).join(','))

  const summary = `Day ${t.clock.day - 1} log | total=$${total.toFixed(1)} town=$${e.townCash.toFixed(1)} bank=$${e.bankCash.toFixed(1)} tax=${(t.government.salesTaxRate * 100).toFixed(0)}% taxes=$${e.taxesToday.toFixed(1)} tvs=${e.lifetimeTvsBought} loans=${e.lifetimeLoansTaken}`
  t.dailySummaries.push(summary)
}

export function onDayPassed(t: Town) {
  collectHouseBill(t, RENT_PER_HOUSE, 'rent')
  collectHouseBill(t, UTILITY_PER_HOUSE, 'utilities')
  collectLoanPayments(t)
  maybeMedicalBill(t)
  settleSalesTax(t)
}

export function finishDay(t: Town) {
  writeDailyLog(t)
  t.economy.dailySales = {}
  t.economy.townInToday = 0
  t.economy.townOutToday = 0
  t.economy.taxesToday = 0
  for (const b of t.buildings.values()) {
    if (b.jobSlots > 0 && needsWorkers(b, t) && b.managerId === '') b.hiringOpen = true
  }
  checkTurnover(t)
  for (const n of t.npcs) {
    n.mealsToday = 0
    n.hoursWorkedToday = 0
    n.activityLog = []
  }
}

export function takeItem(b: SimBuilding, item: string, amount = 1) {
  const n = Math.min(amount, b.shelfStock[item] || 0)
  b.shelfStock[item] = (b.shelfStock[item] || 0) - n
  return n
}

export function addToShelf(b: SimBuilding, item: string, amount: number) {
  const cap = b.shelfItems[item] || 0
  b.shelfStock[item] = Math.min(cap, (b.shelfStock[item] || 0) + amount)
}

export function pendingQty(b: SimBuilding, item: string) {
  let n = 0
  for (const o of b.pendingOrders) if (o.item === item) n += o.qty
  return n
}

export function rosterCount(b: SimBuilding, t: Town) {
  return t.npcs.filter(n => n.jobId === b.buildingId).length
}

export function rosterCountShift(b: SimBuilding, t: Town, shift: string) {
  return t.npcs.filter(n => n.jobId === b.buildingId && n.jobShift === shift).length
}

export function needsWorkers(b: SimBuilding, t: Town) {
  if (!Object.keys(b.shiftSlots).length) return rosterCount(b, t) < b.jobSlots
  for (const shift in b.shiftSlots) {
    if (rosterCountShift(b, t, shift) < b.shiftSlots[shift]) return true
  }
  return false
}
