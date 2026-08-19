import {
  BEDS_PER_HOUSE, BREAKUP_OPINION, COHABIT_BASE, EXCLUSIVE_ROMANCE, FLIRT_MIN_OPINION,
  FRIEND_OPINION, INTERACTIONS, LOVER_ROMANCE, MEMORY_CAP, OPINION_MAX, OPINION_MIN,
  RIVAL_OPINION,
} from './config.ts'
import { openBeds, reassignBeds } from './economy.ts'
import { clamp } from './rng.ts'
import type { Npc, RelRecord, RelationshipsState, Town } from './types.ts'

export function makeRelationships(): RelationshipsState {
  return {
    relations: {},
    lifetimeFriendships: 0,
    lifetimeRivalries: 0,
    lifetimeRomances: 0,
    lifetimeExclusives: 0,
    lifetimeBreakups: 0,
    lifetimeCohabits: 0,
  }
}

function blank(): RelRecord {
  return { opinion: 0, romance: 0, interactions: 0, last_day: -1, memories: [], is_ex: false }
}

export function rec(t: Town, a: Npc, b: Npc) {
  const rel = t.relationships.relations
  rel[a.npcName] ||= {}
  rel[a.npcName][b.npcName] ||= blank()
  return rel[a.npcName][b.npcName]
}

export function opinion(t: Town, a: Npc, b: Npc) {
  return rec(t, a, b).opinion
}

export function romanceOf(t: Town, a: Npc, b: Npc) {
  return rec(t, a, b).romance
}

export function npcByName(t: Town, name: string) {
  return t.npcs.find(n => n.npcName === name) || null
}

export function labelFor(t: Town, a: Npc, b: Npc) {
  if (a.exclusivePartner === b.npcName) return 'partner'
  if (a.lovers.includes(b.npcName)) return 'lover'
  const r = rec(t, a, b)
  if (r.is_ex) return 'ex'
  if (r.opinion <= RIVAL_OPINION) return 'rival'
  if (r.opinion >= FRIEND_OPINION) return 'friend'
  return 'acquaintance'
}

export function compat(a: Npc, b: Npc) {
  const diff = Math.abs(a.openness - b.openness) + Math.abs(a.extraversion - b.extraversion)
  const warmth = a.agreeableness + b.agreeableness + a.honesty_humility + b.honesty_humility
  return clamp(warmth * 0.2 - diff * 0.25, -1, 1)
}

export function partnerWeight(t: Town, a: Npc, b: Npc) {
  const r = rec(t, a, b)
  let w = 40 + r.opinion * 0.6 + compat(a, b) * 25
  if (r.interactions === 0) w += 12 + a.openness * 8
  if (r.opinion <= RIVAL_OPINION) w -= 25
  if (a.lovers.includes(b.npcName)) w += 20
  if (a.exclusivePartner === b.npcName) w += 30
  if (a.aspirationLong === 'find_relationship' && !a.lovers.length) w += 15
  return Math.max(1, w)
}

export function pickPartner(t: Town, npc: Npc, candidates: Npc[]) {
  if (!candidates.length) return null
  let best = candidates[0]
  let bestW = -999
  for (const c of candidates) {
    const w = partnerWeight(t, npc, c) * t.rng.randfRange(0.85, 1.15)
    if (w > bestW) { bestW = w; best = c }
  }
  return best
}

export function pickInteraction(t: Town, a: Npc, b: Npc) {
  const op = opinion(t, a, b)
  const c = compat(a, b)
  let hostile = 0.04 - a.agreeableness * 0.1 - a.honesty_humility * 0.08
  if (op < 0) hostile += 0.12 + Math.abs(op) * 0.008
  if (op < -15 || t.rng.chance(clamp(hostile, 0.015, 0.4))) {
    if (a.agreeableness < 0 && t.rng.chance(0.5)) return 'insult'
    return 'argument'
  }
  const blocked = (a.exclusivePartner && a.exclusivePartner !== b.npcName) ||
    (b.exclusivePartner && b.exclusivePartner !== a.npcName)
  if (!blocked) {
    let flirtChance = 0.08 + a.extraversion * 0.12 + Math.max(0, op) * 0.004
    if (a.aspirationLong === 'find_relationship' && !a.lovers.length) flirtChance += 0.12
    if (a.lovers.includes(b.npcName) || a.exclusivePartner === b.npcName) flirtChance += 0.15
    if (op >= FLIRT_MIN_OPINION && romanceOf(t, a, b) < 95 && t.rng.chance(flirtChance)) return 'flirt'
  }
  if (a.openness > 0.2 && c > 0.1 && t.rng.chance(0.35)) return 'deep_talk'
  if (c < -0.2 || (a.neuroticism > 0.4 && t.rng.chance(0.3))) return 'awkward_chat'
  return 'pleasant_chat'
}

function bump(t: Town, a: Npc, b: Npc, delta: number, rom: number, tag: string) {
  const r = rec(t, a, b)
  const soft = 1 + a.agreeableness * 0.15 - a.neuroticism * 0.1
  r.opinion = clamp(r.opinion + delta * soft, OPINION_MIN, OPINION_MAX)
  r.romance = clamp(r.romance + rom, 0, 100)
  r.interactions += 1
  r.last_day = t.clock.day
  r.memories.push({ day: t.clock.day, tag, delta })
  while (r.memories.length > MEMORY_CAP) r.memories.shift()
}

function applyNeeds(npc: Npc, recipe: { social?: number; fun?: number; meaning?: number }) {
  if (recipe.social) npc.social = clamp(npc.social + recipe.social, 0, 100)
  if (recipe.fun) npc.fun = clamp(npc.fun + recipe.fun, 0, 100)
  if (recipe.meaning) npc.meaning = clamp(npc.meaning + recipe.meaning, 0, 100)
}

function syncLabels(t: Town, a: Npc, b: Npc) {
  const r = rec(t, a, b)
  if (r.romance >= LOVER_ROMANCE && !a.lovers.includes(b.npcName)) {
    if (a.exclusivePartner && a.exclusivePartner !== b.npcName) return
    if (b.exclusivePartner && b.exclusivePartner !== a.npcName) return
    a.lovers.push(b.npcName)
    t.relationships.lifetimeRomances += 1
    a.activityLog.push('fell for ' + b.npcName)
  }
  if (r.romance < LOVER_ROMANCE * 0.5 && a.lovers.includes(b.npcName)) {
    a.lovers = a.lovers.filter(n => n !== b.npcName)
    r.is_ex = true
    if (a.exclusivePartner === b.npcName) {
      a.exclusivePartner = ''
      if (b.exclusivePartner === a.npcName) b.exclusivePartner = ''
    }
    t.relationships.lifetimeBreakups += 1
    a.activityLog.push('broke things off with ' + b.npcName)
  }
  if (r.opinion <= RIVAL_OPINION && r.interactions >= 2 && !r.memories.some(m => m.tag === 'became_rival')) {
    t.relationships.lifetimeRivalries += 1
    r.memories.push({ day: t.clock.day, tag: 'became_rival', delta: 0 })
    a.activityLog.push('now rivals with ' + b.npcName)
  }
  if (r.opinion >= FRIEND_OPINION && r.interactions >= 2 && !r.memories.some(m => m.tag === 'became_friend')) {
    t.relationships.lifetimeFriendships += 1
    r.memories.push({ day: t.clock.day, tag: 'became_friend', delta: 0 })
    a.activityLog.push('became friends with ' + b.npcName)
  }
}

function flirtAccepted(t: Town, a: Npc, b: Npc) {
  let chance = 0.35 + opinion(t, b, a) * 0.01 + compat(a, b) * 0.25 + b.extraversion * 0.1
  if (b.exclusivePartner && b.exclusivePartner !== a.npcName) chance -= 0.5
  if (b.lovers.includes(a.npcName)) chance += 0.25
  return t.rng.chance(clamp(chance, 0.05, 0.95))
}

function jealousyCheck(t: Town, a: Npc, b: Npc) {
  const recipe = INTERACTIONS.jealousy
  for (const otherName of a.lovers) {
    if (otherName === b.npcName) continue
    const other = npcByName(t, otherName)
    if (!other) continue
    const j = 0.2 + other.neuroticism * 0.35 - other.openness * 0.2 - other.honesty_humility * 0.15
    if (t.rng.chance(clamp(j, 0.05, 0.8))) {
      bump(t, other, a, recipe.opinion, recipe.romance, 'jealousy')
      applyNeeds(other, recipe)
      other.activityLog.push(`jealous of ${a.npcName} over ${b.npcName}`)
    }
  }
  for (const otherName of b.lovers) {
    if (otherName === a.npcName) continue
    const other = npcByName(t, otherName)
    if (!other) continue
    const j = 0.2 + other.neuroticism * 0.35 - other.openness * 0.2
    if (t.rng.chance(clamp(j, 0.05, 0.8))) {
      bump(t, other, b, recipe.opinion, recipe.romance, 'jealousy')
      applyNeeds(other, recipe)
      other.activityLog.push(`jealous of ${b.npcName} over ${a.npcName}`)
    }
  }
}

function endRomance(t: Town, a: Npc, otherName: string, reason: string) {
  a.lovers = a.lovers.filter(n => n !== otherName)
  if (a.exclusivePartner === otherName) a.exclusivePartner = ''
  const other = npcByName(t, otherName)
  if (!other) return
  if (other.exclusivePartner === a.npcName) other.exclusivePartner = ''
  other.lovers = other.lovers.filter(n => n !== a.npcName)
  const r = rec(t, a, other)
  r.is_ex = true
  r.romance = Math.min(r.romance, LOVER_ROMANCE * 0.3)
  bump(t, a, other, INTERACTIONS.breakup.opinion, INTERACTIONS.breakup.romance, 'breakup')
  bump(t, other, a, INTERACTIONS.breakup.opinion * 0.7, INTERACTIONS.breakup.romance * 0.7, 'breakup')
  t.relationships.lifetimeBreakups += 1
  a.activityLog.push(`ended romance with ${otherName} (${reason})`)
}

function makeExclusive(t: Town, a: Npc, b: Npc) {
  if (a.exclusivePartner && a.exclusivePartner !== b.npcName) endRomance(t, a, a.exclusivePartner, 'went exclusive')
  if (b.exclusivePartner && b.exclusivePartner !== a.npcName) endRomance(t, b, b.exclusivePartner, 'went exclusive')
  for (const name of [...a.lovers]) if (name !== b.npcName) endRomance(t, a, name, 'went exclusive')
  for (const name of [...b.lovers]) if (name !== a.npcName) endRomance(t, b, name, 'went exclusive')
  if (!a.lovers.includes(b.npcName)) a.lovers.push(b.npcName)
  if (!b.lovers.includes(a.npcName)) b.lovers.push(a.npcName)
  a.exclusivePartner = b.npcName
  b.exclusivePartner = a.npcName
  t.relationships.lifetimeExclusives += 1
}

function maybePropose(t: Town, a: Npc, b: Npc) {
  if (a.exclusivePartner || b.exclusivePartner) return
  if (romanceOf(t, a, b) < EXCLUSIVE_ROMANCE || romanceOf(t, b, a) < EXCLUSIVE_ROMANCE) return
  if (opinion(t, a, b) < 30 || opinion(t, b, a) < 30) return
  let proposeChance = 0.15 + a.conscientiousness * 0.15 + a.honesty_humility * 0.1 - a.openness * 0.12
  if (a.lovers.length > 1) proposeChance -= 0.1
  if (!t.rng.chance(clamp(proposeChance, 0.02, 0.55))) return
  let accept = 0.4 + b.conscientiousness * 0.2 + b.agreeableness * 0.15 + b.honesty_humility * 0.15
  accept -= b.openness * 0.2
  if (b.lovers.length > 1) accept -= 0.15 * (b.lovers.length - 1)
  if (t.rng.chance(clamp(accept, 0.05, 0.9))) {
    makeExclusive(t, a, b)
    bump(t, a, b, INTERACTIONS.propose_accept.opinion, INTERACTIONS.propose_accept.romance, 'propose_accept')
    bump(t, b, a, INTERACTIONS.propose_accept.opinion, INTERACTIONS.propose_accept.romance, 'propose_accept')
    applyNeeds(a, INTERACTIONS.propose_accept)
    applyNeeds(b, INTERACTIONS.propose_accept)
    a.activityLog.push(`and ${b.npcName} became exclusive`)
    b.activityLog.push(`and ${a.npcName} became exclusive`)
  } else {
    bump(t, a, b, INTERACTIONS.propose_reject.opinion, INTERACTIONS.propose_reject.romance, 'propose_reject')
    bump(t, b, a, INTERACTIONS.propose_reject.opinion * 0.4, 0, 'propose_reject')
    applyNeeds(a, INTERACTIONS.propose_reject)
    a.activityLog.push(`${b.npcName} declined exclusivity`)
    b.activityLog.push(`turned down exclusivity with ${a.npcName}`)
  }
}

function maybeBreakExclusive(t: Town, a: Npc, b: Npc) {
  if (a.exclusivePartner !== b.npcName) return
  if (opinion(t, a, b) > BREAKUP_OPINION && opinion(t, b, a) > BREAKUP_OPINION) return
  a.exclusivePartner = ''
  b.exclusivePartner = ''
  endRomance(t, a, b.npcName, 'broke up')
  b.lovers = b.lovers.filter(n => n !== a.npcName)
  rec(t, b, a).is_ex = true
  a.activityLog.push('broke up with ' + b.npcName)
  b.activityLog.push('broke up with ' + a.npcName)
}

export function finishSocialize(t: Town, a: Npc, b: Npc) {
  if (!a || !b) return ''
  const tag = pickInteraction(t, a, b)
  if (tag === 'flirt') {
    if (flirtAccepted(t, a, b)) {
      const recipe = INTERACTIONS.flirt
      bump(t, a, b, recipe.opinion, recipe.romance, 'flirt')
      bump(t, b, a, recipe.opinion * 0.8, recipe.romance * 0.7, 'flirt')
      applyNeeds(a, recipe)
      applyNeeds(b, recipe)
      syncLabels(t, a, b)
      syncLabels(t, b, a)
      jealousyCheck(t, a, b)
      maybePropose(t, a, b)
      a.lastConversationDay = t.clock.day
      b.lastConversationDay = t.clock.day
      a.activityLog.push('flirted with ' + b.npcName)
      b.activityLog.push(a.npcName + ' flirted with them')
      return 'flirt'
    }
    const rej = INTERACTIONS.flirt_reject
    bump(t, a, b, rej.opinion, rej.romance, 'flirt_reject')
    bump(t, b, a, rej.opinion * 0.3, 0, 'flirt_reject')
    applyNeeds(a, rej)
    a.lastConversationDay = t.clock.day
    a.activityLog.push(b.npcName + ' rejected their flirt')
    b.activityLog.push('turned down a flirt from ' + a.npcName)
    return 'flirt_reject'
  }
  const recipe = INTERACTIONS[tag]
  const mirror = 0.7 + b.agreeableness * 0.15
  bump(t, a, b, recipe.opinion, recipe.romance, tag)
  bump(t, b, a, recipe.opinion * mirror, recipe.romance * 0.5, tag)
  applyNeeds(a, recipe)
  applyNeeds(b, recipe)
  syncLabels(t, a, b)
  syncLabels(t, b, a)
  maybeBreakExclusive(t, a, b)
  maybePropose(t, a, b)
  a.lastConversationDay = t.clock.day
  b.lastConversationDay = t.clock.day
  a.activityLog.push(tag.replace(/_/g, ' ') + ' with ' + b.npcName)
  b.activityLog.push(tag.replace(/_/g, ' ') + ' with ' + a.npcName)
  return tag
}

export function hasLover(npc: Npc) {
  return npc.lovers.length > 0
}

export function recentConversation(t: Town, npc: Npc, withinDays = 3) {
  if (npc.lastConversationDay < 0) return false
  return t.clock.day - npc.lastConversationDay <= withinDays
}

export function friendsOf(t: Town, npc: Npc) {
  const row = t.relationships.relations[npc.npcName] || {}
  return Object.keys(row).filter(o => row[o].opinion >= FRIEND_OPINION)
}

export function rivalsOf(t: Town, npc: Npc) {
  const row = t.relationships.relations[npc.npcName] || {}
  return Object.keys(row).filter(o => row[o].opinion <= RIVAL_OPINION)
}

function opinionRows(t: Town, npc: Npc, pred: (a: number, b: number) => number) {
  const row = t.relationships.relations[npc.npcName] || {}
  const rows = Object.keys(row).map(name => {
    const other = npcByName(t, name)
    return { name, opinion: row[name].opinion, label: other ? labelFor(t, npc, other) : '' }
  })
  rows.sort((a, b) => pred(a.opinion, b.opinion))
  return rows
}

export function snapshotFor(t: Town, npc: Npc) {
  return {
    friends: friendsOf(t, npc),
    rivals: rivalsOf(t, npc),
    lovers: [...npc.lovers],
    exclusive_partner: npc.exclusivePartner,
    top_opinions: opinionRows(t, npc, (a, b) => b - a).slice(0, 3),
    low_opinions: opinionRows(t, npc, (a, b) => a - b).slice(0, 2),
    home: npc.homeId,
  }
}

function repairExclusive(t: Town) {
  for (const n of t.npcs) {
    if (!n.exclusivePartner) continue
    const p = npcByName(t, n.exclusivePartner)
    if (!p || p.exclusivePartner !== n.npcName) {
      n.exclusivePartner = ''
      continue
    }
    if (!n.lovers.includes(p.npcName)) n.lovers.push(p.npcName)
    if (!p.lovers.includes(n.npcName)) p.lovers.push(n.npcName)
  }
}

function fadeMemories(t: Town) {
  for (const an in t.relationships.relations) {
    for (const bn in t.relationships.relations[an]) {
      const r = t.relationships.relations[an][bn]
      r.opinion += (0 - r.opinion) * 0.01
      r.memories = r.memories.filter(m => t.clock.day - m.day <= 14)
    }
  }
}

export function cohabitDesire(npc: Npc) {
  return clamp(COHABIT_BASE + npc.agreeableness * 0.08 + npc.conscientiousness * 0.08 - npc.openness * 0.1, 0.4, 0.98)
}

function attemptMoveIn(t: Town, a: Npc, b: Npc) {
  const openA = openBeds(t, a.homeId)
  const openB = openBeds(t, b.homeId)
  if (openA <= 0 && openB <= 0) {
    a.activityLog.push(`wants to live with ${b.npcName} but no bed free`)
    b.activityLog.push(`wants to live with ${a.npcName} but no bed free`)
    return
  }
  let mover: Npc
  let host: Npc
  if (openB > 0 && (openA <= 0 || cohabitDesire(b) >= cohabitDesire(a))) {
    mover = a; host = b
  } else if (openA > 0) {
    mover = b; host = a
  } else return
  const old = mover.homeId
  mover.homeId = host.homeId
  reassignBeds(t, old)
  reassignBeds(t, host.homeId)
  t.relationships.lifetimeCohabits += 1
  mover.activityLog.push(`moved in with ${host.npcName} at ${host.homeId}`)
  host.activityLog.push(mover.npcName + ' moved in')
}

function tryCohabitation(t: Town) {
  const seen: Record<string, boolean> = {}
  for (const n of t.npcs) {
    if (!n.exclusivePartner) continue
    const key = [n.npcName, n.exclusivePartner].sort().join('|')
    if (seen[key]) continue
    seen[key] = true
    const p = npcByName(t, n.exclusivePartner)
    if (!p || p.exclusivePartner !== n.npcName || n.homeId === p.homeId) continue
    if (t.rng.rand() > Math.min(cohabitDesire(n), cohabitDesire(p))) continue
    attemptMoveIn(t, n, p)
  }
}

export function onRelDayPassed(t: Town) {
  repairExclusive(t)
  fadeMemories(t)
  tryCohabitation(t)
}

export function relCounts(t: Town) {
  let friends = 0, rivals = 0, lovers = 0, exclusive = 0, cohabiting = 0
  const seen: Record<string, boolean> = {}
  for (const n of t.npcs) {
    friends += friendsOf(t, n).length
    rivals += rivalsOf(t, n).length
    lovers += n.lovers.length
    if (!n.exclusivePartner) continue
    const key = [n.npcName, n.exclusivePartner].sort().join('|')
    if (seen[key]) continue
    seen[key] = true
    exclusive += 1
    const p = npcByName(t, n.exclusivePartner)
    if (p && p.homeId === n.homeId) cohabiting += 1
  }
  const r = t.relationships
  return {
    friend_links: friends, rival_links: rivals, lover_links: lovers,
    exclusive_couples: exclusive, cohabiting_couples: cohabiting,
    lifetime_friendships: r.lifetimeFriendships, lifetime_rivalries: r.lifetimeRivalries,
    lifetime_romances: r.lifetimeRomances, lifetime_exclusives: r.lifetimeExclusives,
    lifetime_breakups: r.lifetimeBreakups, lifetime_cohabits: r.lifetimeCohabits,
  }
}
