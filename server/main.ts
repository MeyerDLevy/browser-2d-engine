import * as esbuild from 'esbuild'
import { createServer } from 'http'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, type Dirent } from 'fs'
import { loadCatalog, saveCatalog, cropCell } from './materials.ts'
import { storeGet, storePut } from './bucket.ts'
import { join } from 'path'
import { WebSocketServer, WebSocket } from 'ws'
import { MAP_SIZE, TICK_DT, TICK_HZ, applyMap, serializeMap, type MapData } from '../shared/world.ts'
import { createGame, nearby, spawnPlayer, step } from '../shared/sim.ts'
import { emptyInput, type ClientMsg, type Input } from '../shared/protocol.ts'
import type { GameState } from '../shared/entities.ts'
import { attachTown, debugOverlays, findNpcByEntity, inspectNpc, needHistograms, setTownSpeed, townHud } from '../shared/town/town.ts'

const PORT = Number(process.env.PORT) || 8080
const PROD = process.env.NODE_ENV === 'production'
const EMPTY_MS = 5 * 60 * 1000
const ROOM_CAP = 8
const MAPS_DIR = 'maps'

if (!existsSync(MAPS_DIR)) mkdirSync(MAPS_DIR)

const build = await esbuild.context({
  entryPoints: ['client/main.ts'],
  bundle: true,
  outfile: 'dist/client.js',
  sourcemap: !PROD,
  target: 'es2022',
  minify: PROD,
})
if (PROD) await build.rebuild()
else await build.watch()

type Client = { id: string; input: Input; inspectId: string; hist: boolean }
type Lobby = {
  id: string
  state: GameState
  clients: Map<WebSocket, Client>
  tick: number
  timer: ReturnType<typeof setInterval>
  emptyTimer: ReturnType<typeof setTimeout>
  mapName: string
  mapData: MapData
}

const lobbies = new Map<string, Lobby>()

function slug(s: string) {
  return (s || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'room'
}

function mapPath(name: string) {
  return join(MAPS_DIR, slug(name) + '.json')
}

function loadMap(name: string): MapData {
  const p = mapPath(name)
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8'))
}

function listMaps() {
  return readdirSync(MAPS_DIR).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5))
}

function listProjectPngs(dir = 'client/assets', prefix = '') {
  const out: string[] = []
  if (!existsSync(dir)) return out
  for (const ent of readdirSync(dir, { withFileTypes: true }) as Dirent[]) {
    if (ent.name.startsWith('_') || ent.name.startsWith('.')) continue
    if (ent.isDirectory()) out.push(...listProjectPngs(join(dir, ent.name), prefix + ent.name + '/'))
    else if (ent.name.endsWith('.png')) out.push(prefix + ent.name)
  }
  return out
}

function getLobby(id: string, mapName = '') {
  id = slug(id)
  if (!lobbies.has(id)) {
    const seed = Math.floor(Math.random() * 1e9)
    let state: GameState
    let mapData: MapData = null
    if (mapName) {
      mapData = loadMap(mapName)
      if (mapData) {
        state = createGame(mapData.seed || seed, mapData.mapSize || MAP_SIZE, true)
        applyMap(state.world, mapData)
        if (mapData.sites?.length) attachTown(state, mapData.sites)
      }
    }
    if (!state) {
      state = createGame(seed, MAP_SIZE)
      mapData = serializeMap(state.world)
    }
    if (!mapData) mapData = serializeMap(state.world)
    const L: Lobby = {
      id,
      state,
      clients: new Map(),
      tick: 0,
      timer: null,
      emptyTimer: null,
      mapName: mapName ? slug(mapName) : '',
      mapData,
    }
    L.timer = setInterval(() => tickLobby(L), 1000 / TICK_HZ)
    lobbies.set(id, L)
    console.log('lobby', id, 'seed', seed, 'map', L.mapName || '(procedural)')
  }
  return lobbies.get(id)
}

function closeLobby(L: Lobby) {
  clearInterval(L.timer)
  clearTimeout(L.emptyTimer)
  lobbies.delete(L.id)
  console.log('lobby closed', L.id)
}

function inspectPayload(L: Lobby, c: Client) {
  if (!c.inspectId || !L.state.town) return undefined
  const npc = findNpcByEntity(L.state.town, c.inspectId)
  return npc ? inspectNpc(L.state.town, npc) : undefined
}

function tickLobby(L: Lobby) {
  const inputs = new Map<string, Input>()
  for (const c of L.clients.values()) inputs.set(c.id, c.input)
  step(L.state, inputs, TICK_DT, Date.now())
  for (const c of L.clients.values()) c.input.actions = []
  L.tick++
  for (const [ws, c] of L.clients) {
    if (ws.readyState !== WebSocket.OPEN) continue
    ws.send(JSON.stringify({
      type: 'snapshot',
      tick: L.tick,
      seq: c.input.seq,
      entities: nearby(L.state, c.id),
      town: L.state.town ? townHud(L.state.town) : undefined,
      inspect: inspectPayload(L, c),
      hist: c.hist && L.state.town ? needHistograms(L.state.town) : undefined,
      debug: L.state.town?.debug ? debugOverlays(L.state.town) : undefined,
    }))
  }
}

function send(ws: WebSocket, msg: object) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function listRooms() {
  return [...lobbies.values()].map(L => ({
    id: L.id,
    players: L.clients.size,
    cap: ROOM_CAP,
    map: L.mapName || null,
  }))
}

function readBody(req): Promise<string> {
  return new Promise(resolve => {
    let d = ''
    req.on('data', c => { d += c })
    req.on('end', () => resolve(d))
  })
}

function readBuf(req): Promise<Buffer> {
  return new Promise(resolve => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.map': 'application/json',
  '.png': 'image/png',
  '.json': 'application/json',
}

const httpServer = createServer(async (req, res) => {
  let p = req.url.split('?')[0]
  if (p === '/') p = '/index.html'

  if (p === '/rooms') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(listRooms()))
    return
  }
  if (p === '/maps' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(listMaps()))
    return
  }
  if (p.startsWith('/maps/') && req.method === 'GET') {
    const name = slug(p.slice('/maps/'.length))
    const data = loadMap(name)
    if (!data) { res.statusCode = 404; res.end('not found'); return }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(data))
    return
  }
  if (p.startsWith('/maps/') && req.method === 'POST') {
    const name = slug(p.slice('/maps/'.length))
    const body = await readBody(req)
    const data = JSON.parse(body)
    writeFileSync(mapPath(name), JSON.stringify(data))
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, name }))
    return
  }
  if (p === '/materials/local-pngs' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(listProjectPngs()))
    return
  }
  if (p === '/materials' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(await loadCatalog()))
    return
  }
  if (p === '/materials' && req.method === 'PUT') {
    const cat = JSON.parse(await readBody(req))
    await saveCatalog(cat)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
    return
  }
  if (p.startsWith('/materials/tilemaps/') && req.method === 'GET') {
    const id = slug(p.slice('/materials/tilemaps/'.length))
    const buf = await storeGet('tilemaps/' + id + '.png')
    if (!buf) { res.statusCode = 404; res.end(); return }
    res.setHeader('Content-Type', 'image/png')
    res.end(buf)
    return
  }
  if (p.startsWith('/materials/tilemaps/') && req.method === 'POST') {
    const id = slug(p.slice('/materials/tilemaps/'.length))
    const buf = await readBuf(req)
    await storePut('tilemaps/' + id + '.png', buf, 'image/png')
    const cat = await loadCatalog()
    if (!cat.tilemaps.find(t => t.id === id)) {
      cat.tilemaps.push({ id, file: 'tilemaps/' + id + '.png', tileSize: 16, gap: 0, groups: [] })
      await saveCatalog(cat)
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, id }))
    return
  }
  if (p.startsWith('/materials/tiles/') && req.method === 'GET') {
    const id = slug(p.slice('/materials/tiles/'.length).replace(/\.png$/, ''))
    const buf = await storeGet('tiles/' + id + '.png')
    if (!buf) { res.statusCode = 404; res.end(); return }
    res.setHeader('Content-Type', 'image/png')
    res.end(buf)
    return
  }
  if (p === '/materials/tiles' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req))
    const cat = await loadCatalog()
    const tm = cat.tilemaps.find(t => t.id === body.tilemapId)
    const sheet = await storeGet(tm.file)
    const groupName = slug(body.group)
    const color = body.color
    const cells = body.cells as { c: number; r: number }[]
    tm.groups.push({ name: groupName, color, cells })
    let n = cat.tiles.filter(t => t.group === groupName).length
    for (const cell of cells) {
      n++
      const tid = groupName + '_' + n
      const png = cropCell(sheet, tm.tileSize, tm.gap, cell.c, cell.r)
      await storePut('tiles/' + tid + '.png', png, 'image/png')
      cat.tiles.push({
        id: tid, group: groupName, n, tilemapId: tm.id,
        c: cell.c, r: cell.r, file: 'tiles/' + tid + '.png',
        description: '', categories: [],
      })
    }
    await saveCatalog(cat)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(cat))
    return
  }

  let file = null
  if (p === '/index.html') file = 'client/index.html'
  else if (p === '/client.js') file = 'dist/client.js'
  else if (p === '/client.js.map') file = 'dist/client.js.map'
  else if (p.startsWith('/assets/')) {
    const name = p.slice('/assets/'.length)
    if (/^[a-zA-Z0-9._-]+(\/[a-zA-Z0-9._-]+)?$/.test(name)) file = 'client/assets/' + name
  }
  if (!file || !existsSync(file)) { res.statusCode = 404; res.end(); return }
  const ext = file.slice(file.lastIndexOf('.'))
  res.setHeader('Content-Type', mime[ext] || 'text/plain')
  res.end(readFileSync(file))
})

const wss = new WebSocketServer({ server: httpServer })

wss.on('connection', ws => {
  let lobby: Lobby = null
  let client: Client = null

  ws.on('message', raw => {
    const msg: ClientMsg = JSON.parse(String(raw))
    if (msg.type === 'join') {
      const L = getLobby(msg.lobby || 'room', msg.map || '')
      if (L.clients.size >= ROOM_CAP) {
        send(ws, { type: 'error', message: 'room full (8)' })
        return
      }
      clearTimeout(L.emptyTimer)
      L.emptyTimer = null
      const p = spawnPlayer(L.state, msg.name || 'survivor')
      client = { id: p.id, input: emptyInput(), inspectId: '', hist: false }
      lobby = L
      L.clients.set(ws, client)
      send(ws, {
        type: 'welcome',
        playerId: p.id,
        seed: L.state.world.seed,
        mapSize: L.state.world.mapSize,
        tick: L.tick,
        lobby: L.id,
        mapData: L.mapData,
      })
      return
    }
    if (msg.type === 'inspect' && client) {
      client.inspectId = msg.targetId || ''
      client.hist = !!msg.targetId || client.hist
      return
    }
    if (msg.type === 'sim' && client && lobby?.state.town) {
      if (msg.speed != null) setTownSpeed(lobby.state.town, msg.speed)
      if (msg.debug != null) lobby.state.town.debug = msg.debug
      if (msg.hist != null) client.hist = msg.hist
      return
    }
    if (msg.type === 'input' && client) {
      client.input = {
        seq: msg.seq,
        up: msg.up, down: msg.down, left: msg.left, right: msg.right,
        actions: client.input.actions.concat(msg.actions),
      }
    }
  })

  ws.on('close', () => {
    if (!lobby || !client) return
    const e = lobby.state.entities.get(client.id)
    if (e?.vehicleId) {
      const v = lobby.state.entities.get(e.vehicleId)
      if (v) v.driverId = undefined
    }
    lobby.state.entities.delete(client.id)
    lobby.clients.delete(ws)
    if (lobby.clients.size === 0) {
      lobby.emptyTimer = setTimeout(() => closeLobby(lobby), EMPTY_MS)
    }
  })
})

httpServer.listen(PORT, () => {
  console.log('listening on ' + PORT)
})
