import * as esbuild from 'esbuild'
import { createServer } from 'http'
import { existsSync, readFileSync } from 'fs'
import { WebSocketServer, WebSocket } from 'ws'
import { MAP_SIZE, TICK_DT, TICK_HZ } from '../shared/world.ts'
import { createGame, nearby, spawnPlayer, step } from '../shared/sim.ts'
import { emptyInput, type ClientMsg, type Input } from '../shared/protocol.ts'
import type { GameState } from '../shared/entities.ts'

const PORT = Number(process.env.PORT) || 8080
const PROD = process.env.NODE_ENV === 'production'
const EMPTY_MS = 5 * 60 * 1000
const ROOM_CAP = 8

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

type Client = { id: string; input: Input }
type Lobby = {
  id: string
  state: GameState
  clients: Map<WebSocket, Client>
  tick: number
  timer: ReturnType<typeof setInterval>
  emptyTimer: ReturnType<typeof setTimeout>
}

const lobbies = new Map<string, Lobby>()

function slug(s: string) {
  return (s || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'room'
}

function getLobby(id: string) {
  id = slug(id)
  if (!lobbies.has(id)) {
    const seed = Math.floor(Math.random() * 1e9)
    const L: Lobby = {
      id,
      state: createGame(seed, MAP_SIZE),
      clients: new Map(),
      tick: 0,
      timer: null,
      emptyTimer: null,
    }
    L.timer = setInterval(() => tickLobby(L), 1000 / TICK_HZ)
    lobbies.set(id, L)
    console.log('lobby', id, 'seed', seed)
  }
  return lobbies.get(id)
}

function closeLobby(L: Lobby) {
  clearInterval(L.timer)
  clearTimeout(L.emptyTimer)
  lobbies.delete(L.id)
  console.log('lobby closed', L.id)
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
  }))
}

const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.map': 'application/json',
  '.png': 'image/png',
}

const httpServer = createServer((req, res) => {
  let p = req.url.split('?')[0]
  if (p === '/') p = '/index.html'
  if (p === '/rooms') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(listRooms()))
    return
  }
  let file = null
  if (p === '/index.html') file = 'client/index.html'
  else if (p === '/client.js') file = 'dist/client.js'
  else if (p === '/client.js.map') file = 'dist/client.js.map'
  else if (p.startsWith('/assets/')) {
    const name = p.slice('/assets/'.length)
    if (/^[a-zA-Z0-9._-]+$/.test(name)) file = 'client/assets/' + name
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
      const L = getLobby(msg.lobby || 'room')
      if (L.clients.size >= ROOM_CAP) {
        send(ws, { type: 'error', message: 'room full (8)' })
        return
      }
      clearTimeout(L.emptyTimer)
      L.emptyTimer = null
      const p = spawnPlayer(L.state, msg.name || 'survivor')
      client = { id: p.id, input: emptyInput() }
      lobby = L
      L.clients.set(ws, client)
      send(ws, {
        type: 'welcome',
        playerId: p.id,
        seed: L.state.world.seed,
        mapSize: L.state.world.mapSize,
        tick: L.tick,
        lobby: L.id,
      })
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
