import { BOOK_GENRES, COOK_BATCH_UNCOOKED, LOAN_AMOUNT, TV_PRICE, UNCOOKED_PRICE, BAR_DRINK } from './config.ts'
import { isDayShift, isNightShift, isServiceHour, isWorkHours } from './clock.ts'
import { needsWorkers, pendingQty, rosterCount, rosterCountShift, snackPrice } from './economy.ts'
import { scoreNeeds, willOverspend } from './personality.ts'
import type { Ad, Npc, SimBuilding, Town, Vec } from './types.ts'

export function staffOn(b: SimBuilding, npc: Npc) {
  if (!b.workersOnShift.includes(npc.id)) b.workersOnShift.push(npc.id)
}

export function staffOff(b: SimBuilding, npc: Npc) {
  b.workersOnShift = b.workersOnShift.filter(id => id !== npc.id)
}

export function isStaffed(b: SimBuilding) {
  return b.workersOnShift.length > 0
}

export function stockOf(b: SimBuilding, item: string) {
  return b.shelfStock[item] || 0
}

export function capacityOf(b: SimBuilding, item: string) {
  return b.shelfItems[item] || 0
}

export function hasStock(b: SimBuilding, item: string) {
  return stockOf(b, item) > 0
}

export function claimOrder(b: SimBuilding, item: string, qty: number) {
  const i = b.pendingOrders.findIndex(o => o.item === item && o.qty === qty)
  if (i < 0) return false
  b.pendingOrders.splice(i, 1)
  return true
}

export function receiveDelivery(b: SimBuilding, item: string, qty: number) {
  const cap = b.backroomItems[item] || 0
  b.backroomStock[item] = Math.min(cap, (b.backroomStock[item] || 0) + qty)
}

export function workerOnShift(t: Town, b: SimBuilding, npc: Npc) {
  if (b.kind === 'gas_station') return npc.jobShift === 'night' ? isNightShift(t.clock) : isDayShift(t.clock)
  if (b.kind === 'bar') return isNightShift(t.clock)
  return isWorkHours(t.clock)
}

export function isOpenNow(t: Town, b: SimBuilding) {
  if (b.kind === 'gas_station') return true
  if (b.kind === 'bar') return isNightShift(t.clock)
  return isWorkHours(t.clock)
}

export function backroomNeedsOrder(b: SimBuilding, item: string) {
  const cap = b.backroomItems[item] || 0
  if (cap <= 0) return false
  return (b.backroomStock[item] || 0) + pendingQty(b, item) < cap * 0.5
}

export function shelfNeedsRestock(b: SimBuilding, item: string) {
  const cap = capacityOf(b, item)
  if (cap <= 0) return false
  return stockOf(b, item) < cap * 0.3 && (b.backroomStock[item] || 0) > 0
}

export function pantryNeedsUncooked(b: SimBuilding) {
  const cap = capacityOf(b, 'uncooked')
  if (cap <= 0) return false
  return stockOf(b, 'uncooked') < cap * 0.3
}

export function pantryNeedsMeals(b: SimBuilding) {
  const cap = capacityOf(b, 'meal')
  if (cap <= 0) return false
  return stockOf(b, 'meal') < cap * 0.3
}

export function restockAmountWanted(b: SimBuilding, item: string) {
  return capacityOf(b, item) - stockOf(b, item)
}

export function takeFromBackroom(b: SimBuilding, item: string, amount: number) {
  const n = Math.min(amount, b.backroomStock[item] || 0)
  b.backroomStock[item] = (b.backroomStock[item] || 0) - n
  return n
}

export function anchor(b: SimBuilding, name: string): Vec {
  return b.anchors[name] || { x: b.ox + b.w / 2, y: b.oy + b.h / 2, z: 0 }
}

function ad(id: string, b: SimBuilding, score: number, extra: Partial<Ad> = {}): Ad {
  return { id, building_id: b.buildingId, score, ...extra }
}

function adsJob(npc: Npc, b: SimBuilding, ads: Ad[], score: number, tickEffects?: Record<string, number>) {
  if (npc.jobId !== b.buildingId) return
  ads.push(ad('work', b, score, tickEffects ? { tick_effects: tickEffects } : {}))
}

function adsHouse(t: Town, npc: Npc, b: SimBuilding, ads: Ad[]) {
  if (npc.homeId !== b.buildingId) return
  let sleepScore = scoreNeeds(npc, 'sleep')
  if (t.clock.hour >= 22 || t.clock.hour < 6) sleepScore += 30
  ads.push(ad('sleep', b, sleepScore))
  ads.push(ad('relax', b, scoreNeeds(npc, 'relax')))
  ads.push(ad('shower', b, scoreNeeds(npc, 'shower')))
  ads.push(ad('sit_couch', b, scoreNeeds(npc, 'sit_couch')))
  ads.push(ad('pray_meditate', b, scoreNeeds(npc, 'pray_meditate')))
  if (npc.hasTv) ads.push(ad('watch_tv', b, scoreNeeds(npc, 'watch_tv')))
  if (npc.hunger < 65 && hasStock(b, 'meal')) ads.push(ad('eat_meal', b, scoreNeeds(npc, 'eat_meal')))
  if (pantryNeedsMeals(b) && stockOf(b, 'uncooked') >= COOK_BATCH_UNCOOKED) {
    ads.push(ad('cook_meal', b, scoreNeeds(npc, 'cook_meal') + (stockOf(b, 'meal') === 0 ? 20 : 0)))
  }
  if (npc.hasBook) {
    const readId = npc.bookGenre ? 'read_' + npc.bookGenre : 'read_novel'
    ads.push(ad('read', b, scoreNeeds(npc, readId)))
  }
}

function adsWarehouse(t: Town, npc: Npc, b: SimBuilding, ads: Ad[]) {
  if (npc.jobId !== b.buildingId || !isWorkHours(t.clock)) return
  const score = 120 - npc.energy * 0.2
  if (npc.jobRole === 'truck_driver') {
    const target = [...t.buildings.values()].find(x => x.pendingOrders.length > 0)
    if (target) {
      const order = target.pendingOrders[0]
      ads.push(ad('deliver_stock', b, 145 - npc.energy * 0.1, {
        target_store: target.buildingId, target_item: order.item, target_qty: order.qty,
      }))
    } else adsJob(npc, b, ads, score)
  } else if (npc.jobRole === 'inventory_manager') {
    adsJob(npc, b, ads, score, { fun: -0.15, comfort: -0.1 })
  } else adsJob(npc, b, ads, score)
}

function eatDestination(t: Town, npc: Npc) {
  const job = t.buildings.get(npc.jobId)
  if (job && (job.kind === 'gas_station' || job.kind === 'grocery')) return job.buildingId
  const g = nearestKind(t, npc, 'grocery')
  return g ? g.buildingId : ''
}

export function nearestKind(t: Town, npc: Npc, kind: string) {
  let best: SimBuilding = null
  let bestD = Infinity
  for (const b of t.buildings.values()) {
    if (b.kind !== kind) continue
    const d = (anchor(b, 'door').x - npc.x) ** 2 + (anchor(b, 'door').y - npc.y) ** 2
    if (d < bestD) { bestD = d; best = b }
  }
  return best
}

function adsStore(t: Town, npc: Npc, b: SimBuilding, ads: Ad[]) {
  if (npc.jobId === b.buildingId && workerOnShift(t, b, npc)) {
    let restockItem = ''
    for (const item in b.shelfItems) {
      if (shelfNeedsRestock(b, item)) { restockItem = item; break }
    }
    if (restockItem) ads.push(ad('restock_shelves', b, 125 - npc.energy * 0.2, { restock_item: restockItem }))
    else adsJob(npc, b, ads, 120 - npc.energy * 0.2)
  }
  if (eatDestination(t, npc) === b.buildingId && npc.hunger < 65) {
    const price = snackPrice(b.kind)
    if (npc.money >= price && hasStock(b, 'snack') && isStaffed(b)) {
      ads.push(ad('shop', b, scoreNeeds(npc, 'shop')))
    }
  }
}

function adsGroceryExtra(t: Town, npc: Npc, b: SimBuilding, ads: Ad[]) {
  const home = t.buildings.get(npc.homeId)
  if (!home || !pantryNeedsUncooked(home)) return
  if (npc.money < UNCOOKED_PRICE) return
  if (hasStock(b, 'uncooked') && isStaffed(b)) {
    ads.push(ad('buy_groceries', b, scoreNeeds(npc, 'buy_groceries') + (stockOf(home, 'uncooked') === 0 ? 25 : 0)))
  }
}

function adsBar(t: Town, npc: Npc, b: SimBuilding, ads: Ad[]) {
  if (npc.jobId === b.buildingId && workerOnShift(t, b, npc)) adsJob(npc, b, ads, 120 - npc.energy * 0.2)
  if (npc.fun < 70 || npc.social < 70) {
    const canPay = npc.money >= BAR_DRINK
    const canBreak = willOverspend(npc) && (npc.savings > 0 || t.economy.bankCash >= LOAN_AMOUNT)
    if ((canPay || canBreak) && isStaffed(b)) ads.push(ad('go_out', b, scoreNeeds(npc, 'go_out')))
  }
}

function adsBigBox(t: Town, npc: Npc, b: SimBuilding, ads: Ad[]) {
  if (!isWorkHours(t.clock) || npc.hasTv || npc.savings < TV_PRICE) return
  ads.push(ad('buy_tv', b, scoreNeeds(npc, 'buy_tv')))
}

function adsChurch(t: Town, npc: Npc, b: SimBuilding, ads: Ad[]) {
  if (npc.jobId === b.buildingId && isServiceHour(t.clock)) adsJob(npc, b, ads, 130 - npc.energy * 0.2)
  const job = t.buildings.get(npc.jobId)
  if (job?.kind !== 'church' && isServiceHour(t.clock) && isStaffed(b)) {
    ads.push(ad('attend_service', b, scoreNeeds(npc, 'attend_service') + 50))
  }
}

function adsLibrary(t: Town, npc: Npc, b: SimBuilding, ads: Ad[]) {
  if (npc.jobId === b.buildingId && isWorkHours(t.clock)) adsJob(npc, b, ads, 120 - npc.energy * 0.2)
  if (npc.hasBook && t.clock.day > npc.bookDueDay) {
    ads.push(ad('return_book', b, 45 + (t.clock.day - npc.bookDueDay) * 15))
  } else if (!npc.hasBook && hasStock(b, 'book') && isStaffed(b)) {
    for (const genre of BOOK_GENRES) {
      ads.push(ad('checkout_book', b, scoreNeeds(npc, 'checkout_' + genre), { genre }))
    }
  }
}

function adsManager(t: Town, npc: Npc, b: SimBuilding, ads: Ad[]) {
  if (!npc.isManager || npc.jobId !== b.buildingId || !workerOnShift(t, b, npc)) return
  let orderItem = ''
  for (const item in b.backroomItems) {
    if (backroomNeedsOrder(b, item)) { orderItem = item; break }
  }
  if (orderItem) ads.push(ad('order_stock', b, 140 - npc.energy * 0.1, { order_item: orderItem }))
  else if (needsWorkers(b, t) && !b.hiringOpen) ads.push(ad('post_job_ad', b, 130 - npc.energy * 0.1))
}

function adsHiring(t: Town, npc: Npc, b: SimBuilding, ads: Ad[]) {
  if (npc.jobId || !b.hiringOpen || !isOpenNow(t, b)) return
  ads.push(ad('apply_for_job', b, 55 + (100 - npc.money) * 0.4))
}

function adsTownHall(t: Town, npc: Npc, b: SimBuilding, ads: Ad[]) {
  if (npc.jobId === b.buildingId && isWorkHours(t.clock)) adsJob(npc, b, ads, 120 - npc.energy * 0.2)
}

export function getAdvertisements(t: Town, b: SimBuilding, npc: Npc): Ad[] {
  const ads: Ad[] = []
  if (b.kind === 'house') adsHouse(t, npc, b, ads)
  else if (b.kind === 'gas_station') { adsStore(t, npc, b, ads); adsManager(t, npc, b, ads); adsHiring(t, npc, b, ads) }
  else if (b.kind === 'grocery') { adsStore(t, npc, b, ads); adsGroceryExtra(t, npc, b, ads); adsManager(t, npc, b, ads); adsHiring(t, npc, b, ads) }
  else if (b.kind === 'bar') { adsBar(t, npc, b, ads); adsManager(t, npc, b, ads); adsHiring(t, npc, b, ads) }
  else if (b.kind === 'church') { adsChurch(t, npc, b, ads); adsManager(t, npc, b, ads); adsHiring(t, npc, b, ads) }
  else if (b.kind === 'library') { adsLibrary(t, npc, b, ads); adsManager(t, npc, b, ads); adsHiring(t, npc, b, ads) }
  else if (b.kind === 'warehouse') adsWarehouse(t, npc, b, ads)
  else if (b.kind === 'big_box') adsBigBox(t, npc, b, ads)
  else if (b.kind === 'town_hall') adsTownHall(t, npc, b, ads)
  return ads
}

export { rosterCount, rosterCountShift, needsWorkers }
