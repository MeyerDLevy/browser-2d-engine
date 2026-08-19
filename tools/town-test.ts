import { createGame } from '../shared/sim.ts'
import { advanceTownMinutes, attachTown } from '../shared/town/town.ts'
import { totalMoney } from '../shared/town/economy.ts'
import { isNightShift, isServiceHour, isWorkHours, makeClock } from '../shared/town/clock.ts'
import { findPath } from '../shared/town/pathfinder.ts'
import { anchor } from '../shared/town/building.ts'
import { serializeMap, applyMap, makeWorld } from '../shared/world.ts'
import { SIGNATURES, SHOP_RECIPE, BUILDING_KINDS } from '../shared/town/config.ts'
import { stampTown } from '../shared/buildings.ts'

let failed = 0
function ok(name: string, cond: any, detail = '') {
  if (cond) console.log('ok  ' + name)
  else {
    failed++
    console.log('FAIL  ' + name + (detail ? '  ' + detail : ''))
  }
}

const seed = 20260802
const a = createGame(seed, 200)
const b = createGame(seed, 200)
ok('town exists', a.town && b.town)
ok('same npc count', a.town.npcs.length === b.town.npcs.length, `${a.town.npcs.length} vs ${b.town.npcs.length}`)
ok('same names', a.town.npcs.map(n => n.npcName).join() === b.town.npcs.map(n => n.npcName).join())
ok('same building ids', [...a.town.buildings.keys()].join() === [...b.town.buildings.keys()].join())

const kinds = new Set([...a.town.buildings.values()].map(x => x.kind))
for (const k of BUILDING_KINDS) ok('has ' + k, kinds.has(k))

const house = a.town.buildings.get('house_0')
const grocery = [...a.town.buildings.values()].find(x => x.kind === 'grocery')
const path = house && grocery ? findPath(a.world, anchor(house, 'bed'), anchor(grocery, 'shelf')) : []
ok('path house to grocery', path.length > 2, 'len=' + path.length)

const c = makeClock()
c.hour = 10
ok('work hours 10', isWorkHours(c))
ok('not night shift 10', !isNightShift(c))
c.hour = 10
c.day = 1
ok('sunday service 10', isServiceHour(c))
c.hour = 20
ok('not work hours 20', !isWorkHours(c))
ok('night shift 20', isNightShift(c))

ok('shop recipe', SHOP_RECIPE.length === 2)
ok('sleep signature', SIGNATURES.sleep.minutes === 120)

a.town.headless = true
const money0 = totalMoney(a.town)
advanceTownMinutes(a, 2 * 24 * 60)
const money1 = totalMoney(a.town)
ok('money conserved 2 days', Math.abs(money1 - money0) < 0.05, `delta=${(money1 - money0).toFixed(4)}`)
ok('clock advanced', a.town.clock.day === 3, 'day=' + a.town.clock.day)

const data = serializeMap(a.world)
ok('sites serialized', Array.isArray(data.sites) && data.sites.length > 0)
const w2 = makeWorld(data.seed, data.mapSize, true)
applyMap(w2, data)
ok('sites roundtrip', (w2.sites || []).length === data.sites.length)
const s3 = { world: w2, entities: new Map(), nextId: 1, town: null }
attachTown(s3 as any, data.sites)
ok('reload has npcs', s3.town && s3.town.npcs.length > 0)

const jobsFilled = a.town.npcs.filter(n => n.jobId).length
ok('some jobs filled', jobsFilled > 5, 'jobs=' + jobsFilled)

const mayor = a.town.npcs.find(n => n.jobRole === 'mayor')
ok('has mayor', !!mayor)

if (failed) {
  console.log(failed + ' failed')
  process.exit(1)
}
console.log('all tests passed')
