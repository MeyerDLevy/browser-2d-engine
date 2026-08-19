import { mkdirSync, writeFileSync } from 'fs'
import { createGame } from '../shared/sim.ts'
import { advanceTownMinutes, inspectNpc } from '../shared/town/town.ts'
import { totalMoney } from '../shared/town/economy.ts'
import { relCounts } from '../shared/town/relationships.ts'
import { traitSummary } from '../shared/town/personality.ts'
import { BEDS_PER_HOUSE } from '../shared/town/config.ts'
import { residentsOf } from '../shared/town/economy.ts'
import { findPath } from '../shared/town/pathfinder.ts'
import { anchor } from '../shared/town/building.ts'

const DAYS = 30
const SEED = 20260802
const MAP = 200

function progress(done: number, total: number) {
  const w = 32
  const f = Math.floor(w * done / total)
  const bar = '#'.repeat(f) + '-'.repeat(w - f)
  const pct = (100 * done / total).toFixed(1)
  process.stdout.write(`\r[${bar}] ${pct}%  day ${Math.min(DAYS, Math.floor(done / (24 * 60)))}/${DAYS}   `)
}

const s = createGame(SEED, MAP)
const t = s.town
if (!t) {
  console.log('no town generated')
  process.exit(1)
}
t.headless = true
t.clock.speed = 0

const startMoney = totalMoney(t)
console.log(`=== town stability run (${DAYS} days) seed=${SEED} map=${MAP} ===`)
console.log('Start money supply: $' + startMoney.toFixed(2))
console.log('NPCs: ' + t.npcs.length + '  buildings: ' + t.buildings.size)
for (const n of t.npcs) {
  const job = n.jobId || '-'
  console.log(`  ${n.npcName} home=${n.homeId} job=${job} $${n.money.toFixed(1)} ${traitSummary(n)}`)
}

const home0 = t.buildings.get('house_0')
const grocery = [...t.buildings.values()].find(b => b.kind === 'grocery')
if (home0 && grocery) {
  const path = findPath(t.world, anchor(home0, 'bed'), anchor(grocery, 'shelf'))
  console.log(`Path house_0 bed -> grocery shelf: ${path.length} waypoints`)
}

const totalTicks = DAYS * 24 * 60
const chunk = 60
for (let i = 0; i < totalTicks; i += chunk) {
  advanceTownMinutes(s, chunk)
  progress(i + chunk, totalTicks)
}
process.stdout.write('\n')

const endMoney = totalMoney(t)
console.log(`=== DONE after ${DAYS} days ===`)
console.log(`End money supply: $${endMoney.toFixed(2)}  (delta $${(endMoney - startMoney).toFixed(2)})`)
for (const line of t.dailySummaries.slice(-3)) console.log(line)

const rc = relCounts(t)
console.log(`Relationships: friends=${rc.friend_links} rivals=${rc.rival_links} lovers=${rc.lover_links} exclusive=${rc.exclusive_couples} cohabiting=${rc.cohabiting_couples} | lifetime romance=${rc.lifetime_romances} exclusive=${rc.lifetime_exclusives} breakups=${rc.lifetime_breakups} cohabits=${rc.lifetime_cohabits}`)

let broke = 0, starving = 0, withTv = 0
for (const n of t.npcs) {
  let job = n.jobId || '(unemployed)'
  if (n.isManager) job += ' (mgr)'
  else if (n.jobRole) job += ` (${n.jobRole})`
  const love = n.exclusivePartner || (n.lovers.join(',') || '-')
  console.log(`  ${n.npcName} $${n.money.toFixed(1)} save=$${n.savings.toFixed(1)} debt=$${n.debt.toFixed(1)} tv=${n.hasTv ? 'Y' : 'n'} home=${n.homeId} love=${love} mid=${n.aspirationMid || '-'} long=${n.aspirationLong || '-'} job=${job} hunger=${n.hunger.toFixed(0)} energy=${n.energy.toFixed(0)} social=${n.social.toFixed(0)} action=${n.currentAction}`)
  if (n.money < 5) broke++
  if (n.hunger < 15) starving++
  if (n.hasTv) withTv++
}

let bedOk = true
for (const b of t.buildings.values()) {
  if (b.kind !== 'house') continue
  if (residentsOf(t, b.buildingId).length > BEDS_PER_HOUSE) {
    bedOk = false
    console.log('BED OVERFLOW at ' + b.buildingId)
  }
}
console.log(`Broke NPCs: ${broke}  Starving NPCs: ${starving}  With TV: ${withTv}  Beds OK: ${bedOk}`)

mkdirSync('logs', { recursive: true })
writeFileSync('logs/sim_log.csv', t.log.lines.join('\n'))
writeFileSync('logs/npc_snapshot.json', JSON.stringify({
  npcs: t.npcs.map(n => ({
    name: n.npcName, home: n.homeId, job: n.jobId, role: n.jobRole, manager: n.isManager,
    shift: n.jobShift, money: n.money, openness: n.openness, conscientiousness: n.conscientiousness,
    extraversion: n.extraversion, agreeableness: n.agreeableness, neuroticism: n.neuroticism,
    transcendence: n.transcendence, honesty_humility: n.honesty_humility,
    aspiration_mid: n.aspirationMid, aspiration_long: n.aspirationLong,
  })),
}, null, 2))
console.log('CSV log: logs/sim_log.csv')

;(globalThis as any).S = s
;(globalThis as any).T = t
;(globalThis as any).inspect = (name: string) => {
  const n = t.npcs.find(x => x.npcName === name)
  return n ? inspectNpc(t, n) : null
}
console.log('interactive: S (game), T (town), inspect("Alex")')
