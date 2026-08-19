import {
  ASPIRATION_MULT_DEFAULT, IMPULSIVITY_K_DEFAULT, MULT_MAX, MULT_MIN,
  SIGNATURES, TRAITS, TRAIT_SD, URGENCY_EXP, UTILITY_GAIN,
} from './config.ts'
import { clamp, lerp, type Rng } from './rng.ts'
import type { Npc } from './types.ts'

export function getTrait(npc: Npc, t: string) {
  return (npc as any)[t] as number
}

export function getNeed(npc: Npc, need: string) {
  return (npc as any)[need] as number
}

export function setNeed(npc: Npc, need: string, v: number) {
  ;(npc as any)[need] = clamp(v, 0, 100)
}

export function rollPersonality(npc: Npc, rng: Rng) {
  for (const t of TRAITS) (npc as any)[t] = clamp(rng.randfn(0, TRAIT_SD), -1, 1)
}

export function traitSummary(npc: Npc) {
  const f = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2)
  return `O ${f(npc.openness)}  C ${f(npc.conscientiousness)}  E ${f(npc.extraversion)}  A ${f(npc.agreeableness)}  N ${f(npc.neuroticism)}  T ${f(npc.transcendence)}  H ${f(npc.honesty_humility)}`
}

export function traitMultiplier(npc: Npc, affinities: Record<string, number>) {
  let m = 1
  for (const t in affinities) m += getTrait(npc, t) * affinities[t]
  return clamp(m, MULT_MIN, MULT_MAX)
}

export function urgency(level: number) {
  return Math.pow((100 - level) / 100, URGENCY_EXP)
}

export function scoreNeeds(npc: Npc, sigId: string) {
  const sig = SIGNATURES[sigId]
  if (!sig) return 0
  const mult = traitMultiplier(npc, sig.affinities || {})
  let total = 0
  for (const need in sig.needs_filled) {
    const level = getNeed(npc, need)
    const u = urgency(level)
    const gain = Math.min(sig.needs_filled[need], 100 - level)
    total += gain * u * lerp(mult, 1, u)
  }
  return total * UTILITY_GAIN
}

export function impulsivityK(_npc: Npc) {
  return IMPULSIVITY_K_DEFAULT
}

export function aspirationMult(_npc: Npc) {
  return ASPIRATION_MULT_DEFAULT
}

export function willOverspend(_npc: Npc) {
  return false
}
