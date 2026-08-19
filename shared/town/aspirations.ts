import { ASPIRATION_HYSTERESIS, ASPIRATIONS, NEED_KEYS } from './config.ts'
import { getNeed, getTrait } from './personality.ts'
import { hasLover, recentConversation } from './relationships.ts'
import type { Npc, Town } from './types.ts'

export function isDone(t: Town, npc: Npc, aspId: string) {
  if (aspId === 'buy_tv') return npc.hasTv
  if (aspId === 'find_relationship') return hasLover(npc)
  if (aspId === 'have_conversation') return recentConversation(t, npc, 3)
  return false
}

export function scoreAspiration(npc: Npc, aspId: string) {
  const entry = ASPIRATIONS[aspId]
  let total = 0
  for (const tr in entry.trait_affinities) total += getTrait(npc, tr) * entry.trait_affinities[tr]
  for (const need in entry.need_pull) {
    const avg = npc.needAvg[need] ?? getNeed(npc, need)
    total += ((100 - avg) / 100) * entry.need_pull[need]
  }
  return total
}

export function aspirationBoost(npc: Npc, actionId: string) {
  let m = 1
  for (const aspId of [npc.aspirationMid, npc.aspirationLong]) {
    if (!aspId || !ASPIRATIONS[aspId]) continue
    const b = ASPIRATIONS[aspId].boosts[actionId]
    if (b) m *= b
  }
  return m
}

export function savingsRateBonus(npc: Npc) {
  let bonus = 0
  for (const aspId of [npc.aspirationMid, npc.aspirationLong]) {
    if (!aspId || !ASPIRATIONS[aspId]) continue
    bonus += ASPIRATIONS[aspId].savings_rate_bonus || 0
  }
  return bonus
}

function bestForHorizon(t: Town, npc: Npc, horizon: string) {
  let bestId = ''
  let bestScore = -999
  for (const aspId in ASPIRATIONS) {
    const entry = ASPIRATIONS[aspId]
    if (entry.horizon !== horizon) continue
    if (isDone(t, npc, aspId)) continue
    const s = scoreAspiration(npc, aspId)
    if (s > bestScore) {
      bestScore = s
      bestId = aspId
    }
  }
  return { id: bestId, score: bestScore }
}

function maybeSet(t: Town, npc: Npc, field: 'aspirationMid' | 'aspirationLong', best: { id: string; score: number }, force: boolean) {
  let cur = npc[field]
  if (cur && (!ASPIRATIONS[cur] || isDone(t, npc, cur))) {
    npc[field] = ''
    cur = ''
  }
  if (!best.id) return
  if (!cur) {
    npc[field] = best.id
    npc.activityLog.push('dreamed of ' + ASPIRATIONS[best.id].label.toLowerCase())
    return
  }
  if (cur === best.id) return
  if (force || best.score > scoreAspiration(npc, cur) + ASPIRATION_HYSTERESIS) {
    npc[field] = best.id
    const was = ASPIRATIONS[cur] ? ASPIRATIONS[cur].label.toLowerCase() : cur
    npc.activityLog.push(`dreamed of ${ASPIRATIONS[best.id].label.toLowerCase()} (was ${was})`)
  }
}

export function dream(t: Town, npc: Npc, force = false) {
  maybeSet(t, npc, 'aspirationMid', bestForHorizon(t, npc, 'mid'), force)
  maybeSet(t, npc, 'aspirationLong', bestForHorizon(t, npc, 'long'), force)
}

export function updateNeedAvg(npc: Npc) {
  for (const need of NEED_KEYS) {
    const level = getNeed(npc, need)
    if (npc.needAvg[need] == null) npc.needAvg[need] = level
    else npc.needAvg[need] += (level - npc.needAvg[need]) * 0.002
  }
}
