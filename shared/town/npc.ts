import {
  ARRIVE_DIST, BUY_GROCERIES_RECIPE, CHECKOUT_RECIPE, COOK_BATCH_MEALS, COOK_BATCH_UNCOOKED,
  COOK_RECIPE, DECAY, DECAY_ASPIRATION, DELIVER_RECIPE, GROCERY_HAUL, NPC_SPEED,
  RESTOCK_RECIPE, SHOP_RECIPE, SIG_TICK_ACTIONS, SIGNATURES, SNACK_HUNGER_RESTORE, TELEPORT_SPEED,
} from './config.ts'
import { isWorkHours } from './clock.ts'
import {
  addToShelf, buySnack, buyTv, buyUncooked, checkoutBook, eatHomeMeal, orderStock,
  payBarTab, payOddJob, payWage, returnBook, takeItem,
} from './economy.ts'
import { needsWorkers } from './economy.ts'
import { aspirationBoost, dream, updateNeedAvg } from './aspirations.ts'
import { scoreNeeds, setNeed } from './personality.ts'
import { finishSocialize, pickPartner } from './relationships.ts'
import {
  anchor, claimOrder, getAdvertisements, hasStock, isStaffed, nearestKind,
  receiveDelivery, restockAmountWanted, staffOff, staffOn, takeFromBackroom,
} from './building.ts'
import { findPath } from './pathfinder.ts'
import type { Ad, Npc, SimBuilding, Town, Vec } from './types.ts'

function building(t: Town, id: string) {
  return t.buildings.get(id)
}

function homeOf(t: Town, npc: Npc) {
  return building(t, npc.homeId)
}

function dist(a: Vec, b: Vec) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function socialPartners(t: Town, npc: Npc) {
  return t.npcs.filter(n => n.id !== npc.id && n.currentAction !== 'sleep')
}

function sigId(npc: Npc) {
  if (npc.currentAction === 'read') return npc.bookGenre ? 'read_' + npc.bookGenre : 'read_novel'
  return npc.currentAction
}

function sigMinutes(id: string) {
  return SIGNATURES[id]?.minutes ?? 15
}

export function goTo(t: Town, npc: Npc, pos: Vec) {
  if (!pos) { npc.moving = false; return }
  npc.dest = { x: pos.x + npc.jitter.x, y: pos.y + npc.jitter.y, z: pos.z || 0 }
  npc.path = []
  npc.pathI = 0
  npc.moving = false
  if (t.clock.speed <= 0 && !t.headless) {
    // still path when paused so they can finish walking
  }
  if (t.headless || t.clock.speed >= TELEPORT_SPEED) {
    npc.x = npc.dest.x
    npc.y = npc.dest.y
    npc.z = npc.dest.z || 0
    npc.moving = false
    return
  }
  npc.path = findPath(t.world, npc, pos, npc.z || 0)
  if (!npc.path.length) {
    if (dist(npc, npc.dest) < 1) {
      npc.x = npc.dest.x
      npc.y = npc.dest.y
    }
    npc.moving = false
    return
  }
  npc.path = npc.path.map(p => ({ x: p.x + npc.jitter.x, y: p.y + npc.jitter.y, z: p.z || 0 }))
  npc.pathI = 0
  npc.moving = dist(npc, npc.dest) > 0.2
}

export function arrived(npc: Npc) {
  return !npc.moving && dist(npc, npc.dest) < ARRIVE_DIST * 2
}

export function walkNpc(t: Town, npc: Npc, dt: number) {
  if (!npc.moving || !npc.path.length) return
  const speed = NPC_SPEED * Math.max(1, t.clock.speed)
  let left = speed * dt
  while (left > 0 && npc.pathI < npc.path.length) {
    const tgt = npc.path[npc.pathI]
    const dx = tgt.x - npc.x, dy = tgt.y - npc.y
    const d = Math.hypot(dx, dy)
    if (d <= left || d < 0.02) {
      npc.x = tgt.x
      npc.y = tgt.y
      left -= d
      npc.pathI++
      if (npc.pathI >= npc.path.length) {
        npc.moving = false
        npc.x = npc.dest.x
        npc.y = npc.dest.y
      }
    } else {
      npc.facing = Math.atan2(dy, dx)
      npc.x += dx / d * left
      npc.y += dy / d * left
      left = 0
    }
  }
}

function abortRecipe(npc: Npc) {
  npc.recipeSteps = []
  npc.currentAction = 'idle'
  npc.currentStep = ''
  npc.carryingFood = false
  npc.carryingStock = 0
  npc.carryingItem = ''
}

function advanceRecipe(t: Town, npc: Npc) {
  if (!npc.recipeSteps.length) {
    npc.currentAction = 'idle'
    npc.currentStep = ''
    return
  }
  npc.currentStep = npc.recipeSteps.shift()
  const b = building(t, npc.workingStore)
  const h = homeOf(t, npc)
  if (npc.currentStep === 'get_snack') { goTo(t, npc, anchor(b, 'shelf')); npc.actionTimer = 10; npc.activityLog.push('grabbing a snack at ' + npc.workingStore) }
  else if (npc.currentStep === 'pay_snack') { goTo(t, npc, anchor(b, 'counter')); npc.actionTimer = 15; npc.activityLog.push('heading to the counter to pay at ' + npc.workingStore) }
  else if (npc.currentStep === 'get_stock') { goTo(t, npc, anchor(b, 'backroom')); npc.actionTimer = 15; npc.activityLog.push(`heading to the backroom for ${npc.restockItem} at ${npc.workingStore}`) }
  else if (npc.currentStep === 'shelve_stock') { goTo(t, npc, anchor(b, 'shelf')); npc.actionTimer = 15; npc.activityLog.push(`carrying ${npc.restockItem} up to the shelf at ${npc.workingStore}`) }
  else if (npc.currentStep === 'get_uncooked') { goTo(t, npc, anchor(b, 'shelf')); npc.actionTimer = 12; npc.activityLog.push('picking up groceries at the grocery') }
  else if (npc.currentStep === 'pay_uncooked') { goTo(t, npc, anchor(b, 'counter')); npc.actionTimer = 15; npc.activityLog.push('paying for groceries') }
  else if (npc.currentStep === 'bring_home') { goTo(t, npc, anchor(h, 'shelf')); npc.actionTimer = 20; npc.activityLog.push('bringing groceries home to the pantry') }
  else if (npc.currentStep === 'get_ingredients') { goTo(t, npc, anchor(h, 'shelf')); npc.actionTimer = 10; npc.activityLog.push('getting ingredients from the pantry') }
  else if (npc.currentStep === 'cook') { goTo(t, npc, anchor(h, 'kitchen')); npc.actionTimer = 30; npc.activityLog.push('cooking a batch of meals') }
  else if (npc.currentStep === 'store_meal') { goTo(t, npc, anchor(h, 'shelf')); npc.actionTimer = 10; npc.activityLog.push('putting cooked meals in the pantry') }
  else if (npc.currentStep === 'get_book') { goTo(t, npc, anchor(b, 'shelf')); npc.actionTimer = 10; npc.activityLog.push('picking a book off the shelf') }
  else if (npc.currentStep === 'checkout_desk') { goTo(t, npc, anchor(b, 'counter')); npc.actionTimer = 15; npc.activityLog.push('heading to the checkout desk') }
  else if (npc.currentStep === 'load_truck') {
    staffOn(b, npc)
    goTo(t, npc, anchor(b, 'shelf'))
    npc.actionTimer = 20
    npc.activityLog.push(`loading ${npc.targetQty} ${npc.targetItem} onto the truck`)
  } else if (npc.currentStep === 'unload_truck') {
    const dest = building(t, npc.targetStore)
    goTo(t, npc, anchor(dest, 'backroom'))
    npc.actionTimer = 20
    npc.activityLog.push('driving a delivery to ' + npc.targetStore)
  }
}

function startAction(t: Town, npc: Npc, ad: Ad) {
  npc.activeAd = ad
  npc.currentAction = ad.id
  npc.restockItem = ad.restock_item || ''
  npc.orderItem = ad.order_item || ''
  npc.targetStore = ad.target_store || ''
  npc.targetItem = ad.target_item || ''
  npc.targetQty = ad.target_qty || 0
  if (ad.building_id) npc.workingStore = ad.building_id
  if (ad.genre) npc.bookGenre = ad.genre
  const b = building(t, npc.workingStore)
  const h = homeOf(t, npc)
  const id = ad.id
  if (id === 'work') {
    npc.workingStore = npc.jobId
    const jb = building(t, npc.jobId)
    staffOn(jb, npc)
    goTo(t, npc, anchor(jb, 'work'))
    npc.actionTimer = 60
    npc.wageAccumMinutes = 0
    npc.activityLog.push('heading to work at ' + npc.jobId)
  } else if (id === 'odd_job') {
    const g = nearestKind(t, npc, 'grocery')
    if (!g) { npc.currentAction = 'idle'; npc.actionTimer = 0; return }
    goTo(t, npc, { x: anchor(g, 'door').x + 1.2, y: anchor(g, 'door').y + 1.2, z: 0 })
    npc.actionTimer = 60
    npc.wageAccumMinutes = 0
    npc.activityLog.push('looking for odd jobs')
  } else if (id === 'shop') { npc.recipeSteps = [...SHOP_RECIPE]; advanceRecipe(t, npc) }
  else if (id === 'restock_shelves') { npc.workingStore = npc.jobId; npc.recipeSteps = [...RESTOCK_RECIPE]; advanceRecipe(t, npc) }
  else if (id === 'buy_groceries') { npc.recipeSteps = [...BUY_GROCERIES_RECIPE]; advanceRecipe(t, npc) }
  else if (id === 'cook_meal') { npc.workingStore = npc.homeId; npc.recipeSteps = [...COOK_RECIPE]; advanceRecipe(t, npc) }
  else if (id === 'eat_meal') { goTo(t, npc, anchor(h, 'shelf')); npc.actionTimer = sigMinutes('eat_meal'); npc.activityLog.push('grabbing a meal from the pantry') }
  else if (id === 'sleep') { goTo(t, npc, npc.bedIndex === 0 ? anchor(h, 'bed') : anchor(h, 'bed2')); npc.actionTimer = sigMinutes('sleep'); npc.activityLog.push('going home to sleep') }
  else if (id === 'go_out') { goTo(t, npc, anchor(b, 'counter')); npc.actionTimer = sigMinutes('go_out'); npc.activityLog.push('heading out to the bar') }
  else if (id === 'socialize') {
    const partner = pickPartner(t, npc, socialPartners(t, npc))
    if (!partner) { npc.currentAction = 'idle'; npc.actionTimer = 0; return }
    npc.chatPartnerId = partner.id
    goTo(t, npc, partner)
    npc.actionTimer = sigMinutes('socialize')
    npc.activityLog.push('socializing with ' + partner.npcName)
  } else if (id === 'relax') {
    const d = anchor(h, 'door')
    goTo(t, npc, { x: d.x + t.rng.randfRange(-0.6, 0.6), y: d.y + t.rng.randfRange(0.3, 1), z: 0 })
    npc.actionTimer = sigMinutes('relax')
    npc.activityLog.push('relaxing at home')
  } else if (id === 'shower') { goTo(t, npc, anchor(h, 'bathroom')); npc.actionTimer = sigMinutes('shower'); npc.activityLog.push('taking a shower') }
  else if (id === 'sit_couch') { goTo(t, npc, anchor(h, 'couch')); npc.actionTimer = sigMinutes('sit_couch'); npc.activityLog.push('sitting on the couch') }
  else if (id === 'watch_tv') { goTo(t, npc, anchor(h, 'couch')); npc.actionTimer = sigMinutes('watch_tv'); npc.activityLog.push('watching TV') }
  else if (id === 'pray_meditate') { goTo(t, npc, anchor(h, 'couch')); npc.actionTimer = sigMinutes('pray_meditate'); npc.activityLog.push('praying / meditating') }
  else if (id === 'attend_service') { goTo(t, npc, anchor(b, 'counter')); npc.actionTimer = sigMinutes('attend_service'); npc.activityLog.push('heading to Sunday service') }
  else if (id === 'checkout_book') { npc.recipeSteps = [...CHECKOUT_RECIPE]; advanceRecipe(t, npc) }
  else if (id === 'return_book') { goTo(t, npc, anchor(b, 'counter')); npc.actionTimer = 15; npc.activityLog.push('returning a book to the library') }
  else if (id === 'read') { goTo(t, npc, anchor(h, 'couch')); npc.actionTimer = sigMinutes(sigId(npc)); npc.activityLog.push('settling in to read (' + npc.bookGenre + ')') }
  else if (id === 'order_stock') { goTo(t, npc, anchor(b, 'backroom')); npc.actionTimer = 20; npc.activityLog.push(`ordering more ${npc.orderItem} for ${npc.workingStore}`) }
  else if (id === 'post_job_ad') { goTo(t, npc, anchor(b, 'door')); npc.actionTimer = 15; npc.activityLog.push('posting a help-wanted ad at ' + npc.workingStore) }
  else if (id === 'apply_for_job') { goTo(t, npc, anchor(b, 'counter')); npc.actionTimer = 20; npc.activityLog.push('applying for a job at ' + npc.workingStore) }
  else if (id === 'deliver_stock') { npc.workingStore = b.buildingId; npc.recipeSteps = [...DELIVER_RECIPE]; advanceRecipe(t, npc) }
  else if (id === 'buy_tv') { goTo(t, npc, anchor(b, 'counter')); npc.actionTimer = 30; npc.activityLog.push('heading to Big Box for a TV') }
}

function chooseAction(t: Town, npc: Npc) {
  const options: Ad[] = []
  for (const b of t.buildings.values()) options.push(...getAdvertisements(t, b, npc))
  if (socialPartners(t, npc).length) options.push({ id: 'socialize', score: scoreNeeds(npc, 'socialize') })
  if (!npc.jobId && isWorkHours(t.clock) && npc.energy > 30) {
    options.push({ id: 'odd_job', score: 40 + (100 - npc.money) * 0.3 })
  }
  for (const o of options) o.score *= aspirationBoost(npc, o.id)
  options.sort((a, b) => b.score - a.score)
  npc.lastOptions = options.slice(0, 3)
  if (options[0]) startAction(t, npc, options[0])
}

function applySigTick(npc: Npc) {
  const sig = SIGNATURES[sigId(npc)]
  if (!sig) return
  const minutes = sig.minutes
  for (const need in sig.needs_filled) setNeed(npc, need, (npc as any)[need] + sig.needs_filled[need] / minutes)
}

function tickAction(t: Town, npc: Npc) {
  if (npc.currentStep) return
  if (npc.currentAction === 'work') {
    if (arrived(npc)) {
      npc.wageAccumMinutes += 1
      npc.energy = Math.max(0, npc.energy - 0.02)
      const fx = npc.activeAd?.tick_effects || {}
      for (const need in fx) setNeed(npc, need, (npc as any)[need] + fx[need])
      if (npc.wageAccumMinutes >= 60) {
        payWage(t, npc, npc.workingStore, 1)
        npc.wageAccumMinutes = 0
      }
    }
  } else if (npc.currentAction === 'odd_job') {
    if (arrived(npc)) {
      npc.wageAccumMinutes += 1
      npc.energy = Math.max(0, npc.energy - 0.03)
      if (npc.wageAccumMinutes >= 60) {
        payOddJob(t, npc, 1)
        npc.wageAccumMinutes = 0
      }
    }
  } else if (npc.currentAction === 'socialize') {
    const partner = t.npcs.find(n => n.id === npc.chatPartnerId)
    if (partner) {
      if (dist(partner, npc.dest) > 1.2) goTo(t, npc, partner)
      if (arrived(npc)) npc.social = Math.min(100, npc.social + 0.2)
    }
  } else if (arrived(npc) && SIG_TICK_ACTIONS.includes(npc.currentAction)) {
    applySigTick(npc)
  }
}

function finishRecipeStep(t: Town, npc: Npc) {
  if (!arrived(npc)) { abortRecipe(npc); return }
  const b = building(t, npc.workingStore)
  const h = homeOf(t, npc)
  const step = npc.currentStep
  if (step === 'get_snack') {
    if (hasStock(b, 'snack')) {
      takeItem(b, 'snack', 1)
      npc.carryingFood = true
      npc.activityLog.push('grabbed a snack at ' + npc.workingStore)
      advanceRecipe(t, npc)
    } else {
      npc.activityLog.push('snack shelf empty at ' + npc.workingStore)
      abortRecipe(npc)
    }
  } else if (step === 'pay_snack') {
    if (isStaffed(b) && buySnack(t, npc, b)) {
      npc.carryingFood = false
      npc.hunger = Math.min(100, npc.hunger + SNACK_HUNGER_RESTORE)
      npc.activityLog.push('bought and ate a snack at ' + npc.workingStore)
    } else {
      addToShelf(b, 'snack', 1)
      npc.carryingFood = false
      npc.activityLog.push("couldn't check out snack at " + npc.workingStore)
    }
    advanceRecipe(t, npc)
  } else if (step === 'get_stock') {
    npc.carryingItem = npc.restockItem
    npc.carryingStock = takeFromBackroom(b, npc.restockItem, restockAmountWanted(b, npc.restockItem))
    npc.activityLog.push(`grabbed ${npc.carryingStock} ${npc.restockItem} from the backroom at ${npc.workingStore}`)
    advanceRecipe(t, npc)
  } else if (step === 'shelve_stock') {
    addToShelf(b, npc.carryingItem, npc.carryingStock)
    npc.activityLog.push(`put ${npc.carryingStock} ${npc.carryingItem} on the shelf at ${npc.workingStore}`)
    npc.carryingStock = 0
    npc.carryingItem = ''
    advanceRecipe(t, npc)
  } else if (step === 'get_uncooked') {
    if (hasStock(b, 'uncooked')) { npc.activityLog.push('picked uncooked off the grocery shelf'); advanceRecipe(t, npc) }
    else { npc.activityLog.push('no uncooked left at the grocery'); abortRecipe(npc) }
  } else if (step === 'pay_uncooked') {
    if (isStaffed(b)) {
      const bought = buyUncooked(t, npc, b, GROCERY_HAUL)
      npc.carryingStock = bought
      npc.carryingItem = 'uncooked'
      if (bought > 0) { npc.activityLog.push('paid for ' + bought + ' uncooked groceries'); advanceRecipe(t, npc) }
      else { npc.activityLog.push("couldn't afford groceries"); abortRecipe(npc) }
    } else { npc.activityLog.push('nobody at the register for groceries'); abortRecipe(npc) }
  } else if (step === 'bring_home') {
    addToShelf(h, 'uncooked', npc.carryingStock)
    npc.activityLog.push('stocked ' + npc.carryingStock + ' uncooked in the pantry')
    npc.carryingStock = 0
    npc.carryingItem = ''
    advanceRecipe(t, npc)
  } else if (step === 'get_ingredients') {
    if (stockOfSafe(h, 'uncooked') >= COOK_BATCH_UNCOOKED) {
      takeItem(h, 'uncooked', COOK_BATCH_UNCOOKED)
      npc.carryingStock = COOK_BATCH_UNCOOKED
      npc.carryingItem = 'uncooked'
      npc.activityLog.push('took ' + npc.carryingStock + ' uncooked to cook')
      advanceRecipe(t, npc)
    } else { npc.activityLog.push('not enough uncooked to cook'); abortRecipe(npc) }
  } else if (step === 'cook') {
    npc.activityLog.push('finished cooking')
    advanceRecipe(t, npc)
  } else if (step === 'store_meal') {
    addToShelf(h, 'meal', COOK_BATCH_MEALS)
    t.economy.lifetimeMealsCooked += COOK_BATCH_MEALS
    npc.activityLog.push('stored ' + COOK_BATCH_MEALS + ' meals in the pantry')
    npc.carryingStock = 0
    npc.carryingItem = ''
    advanceRecipe(t, npc)
  } else if (step === 'get_book') {
    if (hasStock(b, 'book')) {
      takeItem(b, 'book', 1)
      npc.carryingItem = 'book'
      npc.carryingStock = 1
      npc.activityLog.push('grabbed a book off the shelf')
      advanceRecipe(t, npc)
    } else { npc.activityLog.push('no books left on the shelf'); abortRecipe(npc) }
  } else if (step === 'checkout_desk') {
    if (isStaffed(b) && checkoutBook(t, npc, b)) {
      npc.carryingItem = ''
      npc.carryingStock = 0
      npc.activityLog.push('checked out a book (due day ' + npc.bookDueDay + ')')
      advanceRecipe(t, npc)
    } else {
      addToShelf(b, 'book', 1)
      npc.carryingItem = ''
      npc.carryingStock = 0
      npc.activityLog.push("couldn't check out — librarian not at desk")
      abortRecipe(npc)
    }
  } else if (step === 'load_truck') {
    const dest = building(t, npc.targetStore)
    if (dest && claimOrder(dest, npc.targetItem, npc.targetQty)) {
      npc.carryingItem = npc.targetItem
      npc.carryingStock = npc.targetQty
      npc.activityLog.push(`loaded ${npc.carryingStock} ${npc.carryingItem} onto the truck`)
      advanceRecipe(t, npc)
    } else {
      npc.activityLog.push('order for ' + npc.targetItem + ' already claimed')
      staffOff(building(t, npc.workingStore), npc)
      abortRecipe(npc)
    }
  } else if (step === 'unload_truck') {
    const dest = building(t, npc.targetStore)
    receiveDelivery(dest, npc.carryingItem, npc.carryingStock)
    npc.activityLog.push(`delivered ${npc.carryingStock} ${npc.carryingItem} to ${npc.targetStore}`)
    npc.carryingStock = 0
    npc.carryingItem = ''
    staffOff(building(t, npc.workingStore), npc)
    advanceRecipe(t, npc)
  }
}

function stockOfSafe(b: SimBuilding, item: string) {
  return b?.shelfStock[item] || 0
}

function finishAction(t: Town, npc: Npc) {
  if (npc.currentStep) { finishRecipeStep(t, npc); return }
  const b = building(t, npc.workingStore)
  const h = homeOf(t, npc)
  const a = npc.currentAction
  if (a === 'work') {
    if (npc.wageAccumMinutes > 5) payWage(t, npc, npc.workingStore, npc.wageAccumMinutes / 60)
    npc.wageAccumMinutes = 0
    if (b) staffOff(b, npc)
  } else if (a === 'odd_job') {
    if (npc.wageAccumMinutes > 5) payOddJob(t, npc, npc.wageAccumMinutes / 60)
    npc.wageAccumMinutes = 0
  } else if (a === 'eat_meal') {
    if (arrived(npc) && eatHomeMeal(t, npc, h)) npc.activityLog.push('ate a home-cooked meal')
  } else if (a === 'go_out') {
    if (arrived(npc) && payBarTab(t, npc, b)) npc.activityLog.push('had a night out at the bar')
  } else if (a === 'buy_tv') {
    if (arrived(npc) && buyTv(t, npc, npc.workingStore)) npc.activityLog.push('bought a TV! (aspiration=' + npc.aspiration.toFixed(0) + ')')
    else if (arrived(npc)) npc.activityLog.push("couldn't buy the TV")
  } else if (a === 'sleep') {
    npc.activityLog.push('woke up (energy=' + npc.energy.toFixed(0) + ')')
    dream(t, npc)
  } else if (a === 'socialize') {
    const partner = t.npcs.find(n => n.id === npc.chatPartnerId)
    if (arrived(npc) && partner) finishSocialize(t, npc, partner)
    npc.chatPartnerId = ''
  } else if (a === 'shower') npc.activityLog.push('finished showering (hygiene=' + npc.hygiene.toFixed(0) + ')')
  else if (a === 'sit_couch') npc.activityLog.push('got up from the couch (comfort=' + npc.comfort.toFixed(0) + ')')
  else if (a === 'watch_tv') npc.activityLog.push('finished watching TV (fun=' + npc.fun.toFixed(0) + ')')
  else if (a === 'pray_meditate') npc.activityLog.push('finished praying/meditating (meaning=' + npc.meaning.toFixed(0) + ')')
  else if (a === 'attend_service') {
    if (arrived(npc)) { t.economy.lifetimeServicesAttended += 1; npc.activityLog.push('attended Sunday service') }
  } else if (a === 'return_book') {
    if (arrived(npc) && returnBook(t, npc, b)) { npc.bookGenre = ''; npc.activityLog.push('returned a book') }
  } else if (a === 'read') npc.activityLog.push('finished a reading session')
  else if (a === 'order_stock') {
    if (arrived(npc)) {
      const qty = orderStock(t, b, npc.orderItem)
      npc.activityLog.push(qty > 0
        ? `ordered ${qty} ${npc.orderItem} for ${npc.workingStore}`
        : `couldn't afford to order ${npc.orderItem} at ${npc.workingStore}`)
    }
  } else if (a === 'post_job_ad') {
    if (arrived(npc)) { b.hiringOpen = true; npc.activityLog.push('posted help-wanted ad at ' + npc.workingStore) }
  } else if (a === 'apply_for_job') {
    if (arrived(npc) && needsWorkers(b, t)) {
      if (Object.keys(b.shiftSlots).length) {
        for (const shift in b.shiftSlots) {
          const n = t.npcs.filter(x => x.jobId === b.buildingId && x.jobShift === shift).length
          if (n < b.shiftSlots[shift]) { npc.jobShift = shift; break }
        }
      }
      npc.jobId = npc.workingStore
      if (b.managerSlots > 0 && !b.managerId) {
        npc.isManager = true
        b.managerId = npc.npcName
        npc.activityLog.push('hired as manager at ' + npc.workingStore)
      } else {
        npc.isManager = false
        npc.activityLog.push('hired at ' + npc.workingStore)
      }
      b.hiringOpen = false
    } else if (arrived(npc)) npc.activityLog.push('position already filled at ' + npc.workingStore)
  }
  npc.currentAction = 'idle'
  npc.activeAd = null
}

function decayNeeds(npc: Npc) {
  npc.hunger = Math.max(0, npc.hunger - DECAY.hunger)
  npc.social = Math.max(0, npc.social - DECAY.social)
  npc.fun = Math.max(0, npc.fun - DECAY.fun)
  npc.hygiene = Math.max(0, npc.hygiene - DECAY.hygiene)
  npc.comfort = Math.max(0, npc.comfort - DECAY.comfort)
  npc.aspiration = Math.max(0, npc.aspiration - DECAY_ASPIRATION)
  npc.meaning = Math.max(0, npc.meaning - DECAY.meaning)
  if (npc.currentAction !== 'sleep') npc.energy = Math.max(0, npc.energy - DECAY.energy)
  updateNeedAvg(npc)
}

export function onNpcMinute(t: Town, npc: Npc) {
  decayNeeds(npc)
  if (npc.actionTimer > 0) {
    npc.actionTimer -= 1
    tickAction(t, npc)
    if (npc.actionTimer <= 0) finishAction(t, npc)
  }
  npc.rethinkCooldown -= 1
  if (npc.rethinkCooldown <= 0 && npc.actionTimer <= 0) {
    chooseAction(t, npc)
    npc.rethinkCooldown = 3 + t.rng.rand() * 4
  }
}
