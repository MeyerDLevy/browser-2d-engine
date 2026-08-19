import { MAP_SIZE, TICK_HZ, applyMap, makeWorld, type World } from '../shared/world.ts'
import { applyMove } from '../shared/sim.ts'
import { emptyInput, type ServerMsg } from '../shared/protocol.ts'
import type { Entity, GameState } from '../shared/entities.ts'
import { render, resize, screenToWorld, type Cam, type DrawEnt } from './render.ts'
import { visibleTiles } from './vision.ts'
import type { NeedHist, NpcInspect, TownHud } from '../shared/town/types.ts'

function drawHist(canvas: HTMLCanvasElement, hist: NeedHist[]) {
  const ctx = canvas.getContext('2d')
  const w = canvas.width, h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const rowH = h / hist.length
  const bw = (w - 10) / 10
  for (let i = 0; i < hist.length; i++) {
    const row = hist[i]
    const max = Math.max(1, ...row.counts)
    const top = i * rowH
    const bot = top + rowH - 4
    ctx.fillStyle = '#ddd'
    ctx.font = '12px ui-monospace, monospace'
    ctx.textAlign = 'left'
    ctx.fillText(row.need + ' (avg ' + row.avg.toFixed(0) + ')', 0, top + 12)
    for (let j = 0; j < 10; j++) {
      const bh = (row.counts[j] / max) * (rowH - 18)
      ctx.fillStyle = '#66c0e0'
      ctx.fillRect(5 + j * bw, bot - bh, bw - 2, bh)
    }
    ctx.strokeStyle = 'rgba(255,255,255,.25)'
    ctx.beginPath()
    ctx.moveTo(5, bot)
    ctx.lineTo(w - 5, bot)
    ctx.stroke()
  }
}

const params = new URLSearchParams(location.search)
if (params.get('editor')) {
  import('./editor.ts').then(m => m.startEditor())
} else {
  bootGame()
}

function bootGame() {
  const canvas = document.getElementById('c') as HTMLCanvasElement
  const ctx = canvas.getContext('2d')
  const tl = document.getElementById('tl')
  const tr = document.getElementById('tr')
  const bl = document.getElementById('bl')
  const townbar = document.getElementById('townbar')
  const inspectEl = document.getElementById('inspect')
  const histEl = document.getElementById('hist')
  const histc = document.getElementById('histc') as HTMLCanvasElement
  const deadEl = document.getElementById('dead')
  const overlay = document.getElementById('lobby')
  const roomsEl = document.getElementById('rooms')
  const errEl = document.getElementById('err')
  const nameEl = document.getElementById('name') as HTMLInputElement
  const roomEl = document.getElementById('room') as HTMLInputElement
  const mapEl = document.getElementById('map') as HTMLSelectElement
  const goEl = document.getElementById('go') as HTMLButtonElement

  resize(canvas)
  onresize = () => resize(canvas)

  const keys = { up: false, down: false, left: false, right: false }
  const actions: string[] = []
  let seq = 0
  let meId = ''
  let tick = 0
  let lobby = ''
  let name = ''
  let mapName = ''
  let ws: WebSocket = null
  let world: World = makeWorld(1, MAP_SIZE)
  const live = new Map<string, Entity>()
  const prev = new Map<string, { x: number; y: number }>()
  let snapAt = 0
  const cam: Cam = { x: MAP_SIZE / 2, y: MAP_SIZE / 2, zoom: 1 }
  let town: TownHud = null
  let inspect: NpcInspect = null
  let hist: NeedHist[] = null
  let debugOverlay: any = null
  let showHist = false
  let showDebug = false
  let simSpeed = 1

  function slug(s: string) {
    return (s || '').trim().toLowerCase().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'room'
  }

  function playing() {
    return overlay.classList.contains('off')
  }

  const keymap = {
    KeyW: 'up', ArrowUp: 'up',
    KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
  }
  const actmap = { KeyE: 'pickup', KeyG: 'drop', Space: 'attack', KeyF: 'enter' }

  function sendSim(extra: { speed?: number; debug?: boolean; hist?: boolean } = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'sim', ...extra }))
  }
  function sendInspect(id: string | null) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'inspect', targetId: id }))
  }

  onkeydown = ev => {
    if (!playing() || (ev.target as HTMLElement).tagName === 'INPUT' || (ev.target as HTMLElement).tagName === 'SELECT') return
    if (keymap[ev.code] || actmap[ev.code]) ev.preventDefault()
    if (keymap[ev.code]) keys[keymap[ev.code]] = true
    if (actmap[ev.code] && !ev.repeat) {
      actions.push(actmap[ev.code])
      if (actmap[ev.code] === 'attack') {
        const me = live.get(meId)
        if (me && !me.dead) me.attackCd = 0.4
      }
    }
    if (ev.code === 'KeyP') {
      simSpeed = simSpeed > 0 ? 0 : 1
      sendSim({ speed: simSpeed })
    }
    if (ev.code === 'Digit1') { simSpeed = 1; sendSim({ speed: 1 }) }
    if (ev.code === 'Digit2') { simSpeed = 4; sendSim({ speed: 4 }) }
    if (ev.code === 'Digit3') { simSpeed = 16; sendSim({ speed: 16 }) }
    if (ev.code === 'Digit4') { simSpeed = 64; sendSim({ speed: 64 }) }
    if (ev.code === 'F3') {
      ev.preventDefault()
      showHist = !showHist
      histEl.className = showHist ? 'on' : ''
      sendSim({ hist: showHist })
    }
    if (ev.code === 'F4') {
      ev.preventDefault()
      showDebug = !showDebug
      sendSim({ debug: showDebug })
    }
  }
  onkeyup = ev => {
    if (keymap[ev.code]) keys[keymap[ev.code]] = false
  }
  onwheel = ev => {
    if (!playing()) return
    cam.zoom = Math.min(2.4, Math.max(0.35, cam.zoom * (ev.deltaY > 0 ? 0.9 : 1.1)))
  }

  canvas.onclick = ev => {
    if (!playing()) return
    const me = live.get(meId)
    const hit = screenToWorld(cam, ev.clientX, ev.clientY, canvas, me ? (me.z || 0) : 0)
    let best: Entity = null
    let bestD = 1.6 * 1.6
    for (const e of live.values()) {
      if (e.kind !== 'npc') continue
      const d = (e.x - hit.x) ** 2 + (e.y - hit.y) ** 2
      if (d < bestD) { bestD = d; best = e }
    }
    sendInspect(best ? best.id : null)
  }

  function connect(room: string, playerName: string, map = '') {
    lobby = slug(room)
    name = (playerName || 'survivor').slice(0, 20)
    mapName = map ? slug(map) : ''
    errEl.textContent = ''
    live.clear()
    prev.clear()
    meId = ''
    let url = '?lobby=' + encodeURIComponent(lobby) + '&name=' + encodeURIComponent(name)
    if (mapName) url += '&map=' + encodeURIComponent(mapName)
    history.replaceState(null, '', url)
    overlay.classList.add('off')
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    if (ws) { ws.onclose = null; ws.close() }
    const sock = new WebSocket(proto + '://' + location.host)
    ws = sock
    sock.onopen = () => sock.send(JSON.stringify({ type: 'join', lobby, name, map: mapName || undefined }))
    sock.onmessage = ev => {
      const msg: ServerMsg = JSON.parse(ev.data)
      if (msg.type === 'error') {
        overlay.classList.remove('off')
        errEl.textContent = msg.message
        return
      }
      if (msg.type === 'welcome') {
        meId = msg.playerId
        tick = msg.tick
        lobby = msg.lobby
        world = makeWorld(msg.seed, msg.mapSize)
        if (msg.mapData) applyMap(world, msg.mapData)
        return
      }
      if (msg.type === 'snapshot') {
        tick = msg.tick
        snapAt = performance.now()
        const seen = new Set<string>()
        const me = live.get(meId)
        for (const e of msg.entities) {
          seen.add(e.id)
          const old = live.get(e.id)
          if (!old) { live.set(e.id, { ...e }); continue }
          prev.set(e.id, { x: old.x, y: old.y })
          const predict = e.id === meId || (me && e.id === me.vehicleId)
          if (predict) {
            const err = Math.hypot(old.x - e.x, old.y - e.y)
            const sx = old.x, sy = old.y
            Object.assign(old, e)
            if (err < 3) {
              old.x = sx + (e.x - sx) * 0.25
              old.y = sy + (e.y - sy) * 0.25
            }
          } else {
            Object.assign(old, e)
          }
        }
        for (const id of [...live.keys()]) if (!seen.has(id)) live.delete(id)
        town = msg.town || town
        inspect = msg.inspect || null
        if (msg.hist) hist = msg.hist
        debugOverlay = msg.debug || null
      }
    }
    sock.onclose = () => {
      if (ws !== sock) return
      overlay.classList.remove('off')
      if (!errEl.textContent) errEl.textContent = 'disconnected'
    }
  }

  function sendInput() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !meId) return
    seq++
    ws.send(JSON.stringify({
      type: 'input', seq,
      up: keys.up, down: keys.down, left: keys.left, right: keys.right,
      actions: actions.splice(0),
    }))
  }
  setInterval(sendInput, 1000 / TICK_HZ)

  async function refreshRooms() {
    if (playing()) return
    const list = await (await fetch('/rooms')).json()
    if (!list.length) {
      roomsEl.innerHTML = '<span class="muted">none yet — create one</span>'
      return
    }
    roomsEl.innerHTML = ''
    for (const r of list) {
      const row = document.createElement('div')
      row.className = 'room' + (r.players >= r.cap ? ' full' : '')
      row.innerHTML = '<span>' + r.id + (r.map ? ' <span class="muted">(' + r.map + ')</span>' : '') +
        '</span><span>' + r.players + '/' + r.cap + '</span>'
      if (r.players < r.cap) row.onclick = () => connect(r.id, nameEl.value, r.map || '')
      roomsEl.appendChild(row)
    }
  }

  async function refreshMaps() {
    const list = await (await fetch('/maps')).json()
    const cur = mapEl.value
    mapEl.innerHTML = '<option value="">procedural town</option>'
    for (const name of list) {
      const o = document.createElement('option')
      o.value = name
      o.textContent = name
      mapEl.appendChild(o)
    }
    if (cur) mapEl.value = cur
  }

  goEl.onclick = () => connect(roomEl.value || nameEl.value || 'room', nameEl.value, mapEl.value)
  roomEl.onkeydown = ev => { if (ev.key === 'Enter') goEl.click() }
  nameEl.onkeydown = ev => { if (ev.key === 'Enter') goEl.click() }

  nameEl.value = params.get('name') || 'survivor' + Math.floor(Math.random() * 90 + 10)
  if (params.get('map')) mapEl.value = params.get('map')
  refreshRooms()
  refreshMaps()
  setInterval(refreshRooms, 2000)
  setInterval(refreshMaps, 5000)
  if (params.get('lobby')) {
    roomEl.value = params.get('lobby')
    connect(params.get('lobby'), nameEl.value, params.get('map') || '')
  }

  const state: GameState = { world, entities: live, nextId: 0 }
  let last = performance.now()
  const lastDraw = new Map<string, { x: number; y: number }>()

  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    state.world = world
    const me = live.get(meId)
    if (me && !me.dead) applyMove(state, me, { ...emptyInput(), ...keys, seq }, dt)
    if (me) { cam.x = me.x; cam.y = me.y }
    for (const e of live.values()) {
      if (e.kind === 'player' && e.attackCd > 0) e.attackCd -= dt
    }

    const t = Math.min(1, (now - snapAt) / (1000 / TICK_HZ))
    const draw: DrawEnt[] = []
    const meMoving = !!(keys.up || keys.down || keys.left || keys.right)
    for (const e of live.values()) {
      const predict = e.id === meId || (me && e.id === me.vehicleId)
      const p = prev.get(e.id)
      const x = predict || !p ? e.x : p.x + (e.x - p.x) * t
      const y = predict || !p ? e.y : p.y + (e.y - p.y) * t
      const prevD = lastDraw.get(e.id)
      const moving = e.id === meId
        ? meMoving && !e.dead
        : !!(prevD && Math.hypot(x - prevD.x, y - prevD.y) > 0.002)
      lastDraw.set(e.id, { x, y })
      draw.push({ e, x, y, moving })
    }
    const myZ = me ? (me.z || 0) : 0
    const vis = me ? visibleTiles(world, me.x, me.y, myZ) : null
    render(ctx, world, cam, draw, meId, now, vis, me ? me.x : cam.x, me ? me.y : cam.y, null, myZ, null, debugOverlay)

    if (me) {
      const inv = (me.inventory || []).map((it, i) => (i + 1) + '. ' + it.name).join('<br>')
      tl.innerHTML =
        (me.name || '') + '  hp ' + (me.health | 0) + '<br>' +
        me.x.toFixed(1) + ', ' + me.y.toFixed(1) + '  z' + myZ +
        (me.vehicleId ? '<br>in car' : '')
      bl.innerHTML = '<b>inventory</b><br>' + (inv || '<i>empty</i>')
      deadEl.className = me.dead ? 'on' : ''
    }
    const others = [...live.values()].filter(e => e.kind === 'player')
    tr.innerHTML =
      'room ' + lobby + '<br>' +
      'tick ' + tick + '  ents ' + live.size + '<br>' +
      others.map(p => (p.id === meId ? '>' : '') + p.name).join('<br>')
    if (town) {
      const sp = town.paused ? 'PAUSED' : (town.speed.toFixed(0) + 'x')
      townbar.textContent = town.time + '  ' + sp +
        '  $' + town.totalMoney.toFixed(0) +
        '  town $' + town.townCash.toFixed(0) +
        '  tax ' + (town.salesTax * 100).toFixed(0) + '%' +
        '  npcs ' + town.npcCount +
        '  gas ' + town.stocks.gas +
        '  groc ' + town.stocks.grocerySnack + '/' + town.stocks.groceryUncooked +
        '  books ' + town.stocks.books
    }
    if (inspect) {
      inspectEl.className = 'on'
      inspectEl.textContent =
        inspect.name + '\n$' + inspect.money.toFixed(1) +
        ' (save $' + inspect.savings.toFixed(1) + ') debt $' + inspect.debt.toFixed(1) +
        '  TV: ' + (inspect.hasTv ? 'yes' : 'no') +
        '\njob: ' + inspect.job + '   home: ' + inspect.home +
        '\n' + inspect.traits +
        '\naction: ' + inspect.action + '   carrying: ' + inspect.carrying +
        '\n' + inspect.pantry + '\n' + inspect.book +
        '\ntop: ' + inspect.top + '\n\n' + inspect.relations +
        'Hunger      ' + inspect.needs.hunger.toFixed(0) +
        '\nEnergy      ' + inspect.needs.energy.toFixed(0) +
        '\nSocial      ' + inspect.needs.social.toFixed(0) +
        '\nFun         ' + inspect.needs.fun.toFixed(0) +
        '\nHygiene     ' + inspect.needs.hygiene.toFixed(0) +
        '\nComfort     ' + inspect.needs.comfort.toFixed(0) +
        '\nAspiration  ' + inspect.needs.aspiration.toFixed(0) +
        '\nMeaning     ' + inspect.needs.meaning.toFixed(0) +
        '\n\nMeals today: ' + inspect.mealsToday +
        '\nHours worked: ' + inspect.hoursWorked.toFixed(1) +
        '\n\n' + inspect.log.map(l => '• ' + l).join('\n')
    } else inspectEl.className = ''
    if (showHist && hist) drawHist(histc, hist)

    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  ;(window as any).G = { live, cam, get world() { return world }, keys, get ws() { return ws } }
}
