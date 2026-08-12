import {
  EDGE_DOOR, EDGE_NONE, EDGE_WALL, EDGE_WINDOW,
  GRASS, DIRT, ROAD, WATER, WOOD, MAP_SIZE,
  makeWorld, serializeMap, worldFromMap,
  setTile, setEdgeN, setEdgeW, setRoof, edgeN, edgeW,
  type World, type MapData,
} from '../shared/world.ts'
import { render, resize, screenToWorld, type Cam, type PreviewEdge } from './render.ts'
import { clearVisionCache } from './vision.ts'

type Tool = 'wall' | 'door' | 'window' | 'floor' | 'roof' | 'erase'
type EdgeHit = { x: number; y: number; dir: 'N' | 'W' }

const FLOORS = [
  { id: GRASS, name: 'grass' },
  { id: DIRT, name: 'dirt' },
  { id: ROAD, name: 'road' },
  { id: WATER, name: 'water' },
  { id: WOOD, name: 'wood' },
]

export function startEditor() {
  const canvas = document.getElementById('c') as HTMLCanvasElement
  const ctx = canvas.getContext('2d')
  const overlay = document.getElementById('lobby')
  const hud = document.getElementById('hud')
  overlay.classList.add('off')
  hud.style.display = 'none'

  let bar = document.getElementById('editor-bar')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'editor-bar'
    bar.innerHTML = `
      <div id="eb-tools"></div>
      <div id="eb-floors" style="display:none"></div>
      <div id="eb-save">
        <input id="eb-name" placeholder="map name" maxlength="32">
        <button id="eb-save-btn">save</button>
        <button id="eb-load-btn">load</button>
        <select id="eb-maps"></select>
        <button id="eb-blank">blank</button>
        <button id="eb-town">town</button>
        <a href="/" style="color:#ccc;margin-left:8px">back</a>
      </div>
      <div id="eb-msg" class="muted"></div>
    `
    document.body.appendChild(bar)
    const style = document.createElement('style')
    style.textContent = `
      #editor-bar {
        position: absolute; top: 0; left: 0; right: 0;
        display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
        padding: 8px 10px; background: rgba(0,0,0,.72);
        font: 13px ui-monospace, Consolas, monospace; color: #ddd;
        pointer-events: auto; z-index: 5;
      }
      #editor-bar button, #editor-bar select, #editor-bar input {
        font: inherit; background: #2a2824; color: #eee;
        border: 1px solid #555; padding: 5px 8px;
      }
      #editor-bar button.on { background: #5a4030; border-color: #8a6a50; }
      #eb-tools, #eb-floors, #eb-save { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
      #eb-msg { width: 100%; color: #888; }
    `
    document.head.appendChild(style)
  }
  bar.style.display = 'flex'

  const toolsEl = document.getElementById('eb-tools')
  const floorsEl = document.getElementById('eb-floors')
  const msgEl = document.getElementById('eb-msg')
  const nameEl = document.getElementById('eb-name') as HTMLInputElement
  const mapsEl = document.getElementById('eb-maps') as HTMLSelectElement

  let tool: Tool = 'wall'
  let floorType = WOOD
  let world: World = makeWorld(1, MAP_SIZE, false)
  const cam: Cam = { x: MAP_SIZE / 2, y: MAP_SIZE / 2, zoom: 0.8 }
  const keys = { up: false, down: false, left: false, right: false }
  let drag: { start: EdgeHit; cur: EdgeHit } = null
  let painting = false
  let preview: PreviewEdge[] = []

  function setMsg(s: string) { msgEl.textContent = s }

  function rebuildTools() {
    const tools: [Tool, string][] = [
      ['wall', 'wall'], ['door', 'door'], ['window', 'window'],
      ['floor', 'floor'], ['roof', 'roof'], ['erase', 'erase'],
    ]
    toolsEl.innerHTML = ''
    for (const [id, label] of tools) {
      const b = document.createElement('button')
      b.textContent = label
      b.className = tool === id ? 'on' : ''
      b.onclick = () => {
        tool = id
        floorsEl.style.display = id === 'floor' ? 'flex' : 'none'
        rebuildTools()
      }
      toolsEl.appendChild(b)
    }
    floorsEl.innerHTML = ''
    for (const f of FLOORS) {
      const b = document.createElement('button')
      b.textContent = f.name
      b.className = floorType === f.id ? 'on' : ''
      b.onclick = () => { floorType = f.id; rebuildTools() }
      floorsEl.appendChild(b)
    }
  }
  rebuildTools()

  async function refreshMaps() {
    const list = await (await fetch('/maps')).json()
    mapsEl.innerHTML = ''
    for (const name of list) {
      const o = document.createElement('option')
      o.value = name
      o.textContent = name
      mapsEl.appendChild(o)
    }
  }
  refreshMaps()

  document.getElementById('eb-blank').onclick = () => {
    world = makeWorld(1, MAP_SIZE, true)
    clearVisionCache()
    setMsg('blank grass map')
  }
  document.getElementById('eb-town').onclick = () => {
    world = makeWorld(1, MAP_SIZE, false)
    clearVisionCache()
    setMsg('procedural town')
  }
  document.getElementById('eb-save-btn').onclick = async () => {
    const name = (nameEl.value || 'map').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 32)
    if (!name) return
    const res = await fetch('/maps/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serializeMap(world)),
    })
    setMsg(res.ok ? 'saved ' + name : 'save failed')
    nameEl.value = name
    refreshMaps()
  }
  document.getElementById('eb-load-btn').onclick = async () => {
    const name = mapsEl.value
    if (!name) return
    const data: MapData = await (await fetch('/maps/' + name)).json()
    world = worldFromMap(data)
    clearVisionCache()
    nameEl.value = name
    setMsg('loaded ' + name)
  }

  function nearestEdge(tx: number, ty: number): EdgeHit {
    const fx = tx - Math.floor(tx)
    const fy = ty - Math.floor(ty)
    const ix = Math.floor(tx)
    const iy = Math.floor(ty)
    const dN = fy
    const dS = 1 - fy
    const dW = fx
    const dE = 1 - fx
    const m = Math.min(dN, dS, dW, dE)
    if (m === dN) return { x: ix, y: iy, dir: 'N' }
    if (m === dS) return { x: ix, y: iy + 1, dir: 'N' }
    if (m === dW) return { x: ix, y: iy, dir: 'W' }
    return { x: ix + 1, y: iy, dir: 'W' }
  }

  function edgeRun(a: EdgeHit, b: EdgeHit): EdgeHit[] {
    if (a.dir !== b.dir) return [a]
    const out: EdgeHit[] = []
    if (a.dir === 'N') {
      if (a.y !== b.y) return [a]
      const y = a.y
      const x0 = Math.min(a.x, b.x)
      const x1 = Math.max(a.x, b.x)
      for (let x = x0; x <= x1; x++) out.push({ x, y, dir: 'N' })
    } else {
      if (a.x !== b.x) return [a]
      const x = a.x
      const y0 = Math.min(a.y, b.y)
      const y1 = Math.max(a.y, b.y)
      for (let y = y0; y <= y1; y++) out.push({ x, y, dir: 'W' })
    }
    return out
  }

  function applyEdge(e: EdgeHit, kind: number) {
    if (e.dir === 'N') setEdgeN(world, e.x, e.y, kind)
    else setEdgeW(world, e.x, e.y, kind)
  }

  function paintAt(tx: number, ty: number) {
    const ix = Math.floor(tx), iy = Math.floor(ty)
    if (tool === 'floor') setTile(world, ix, iy, floorType)
    else if (tool === 'roof') setRoof(world, ix, iy, true)
    else if (tool === 'erase') {
      const e = nearestEdge(tx, ty)
      const cur = e.dir === 'N' ? edgeN(world, e.x, e.y) : edgeW(world, e.x, e.y)
      if (cur !== EDGE_NONE) applyEdge(e, EDGE_NONE)
      else {
        setRoof(world, ix, iy, false)
        setTile(world, ix, iy, GRASS)
      }
    }
    clearVisionCache()
  }

  resize(canvas)
  onresize = () => resize(canvas)

  onkeydown = ev => {
    if ((ev.target as HTMLElement).tagName === 'INPUT') return
    if (ev.code === 'KeyW' || ev.code === 'ArrowUp') keys.up = true
    if (ev.code === 'KeyS' || ev.code === 'ArrowDown') keys.down = true
    if (ev.code === 'KeyA' || ev.code === 'ArrowLeft') keys.left = true
    if (ev.code === 'KeyD' || ev.code === 'ArrowRight') keys.right = true
  }
  onkeyup = ev => {
    if (ev.code === 'KeyW' || ev.code === 'ArrowUp') keys.up = false
    if (ev.code === 'KeyS' || ev.code === 'ArrowDown') keys.down = false
    if (ev.code === 'KeyA' || ev.code === 'ArrowLeft') keys.left = false
    if (ev.code === 'KeyD' || ev.code === 'ArrowRight') keys.right = false
  }
  onwheel = ev => {
    cam.zoom = Math.min(2.4, Math.max(0.25, cam.zoom * (ev.deltaY > 0 ? 0.9 : 1.1)))
  }

  canvas.onmousedown = ev => {
    const wpos = screenToWorld(cam, ev.clientX, ev.clientY, canvas)
    if (tool === 'wall' || tool === 'door' || tool === 'window') {
      const e = nearestEdge(wpos.x, wpos.y)
      drag = { start: e, cur: e }
      preview = [{ ...e, kind: tool === 'door' ? EDGE_DOOR : tool === 'window' ? EDGE_WINDOW : EDGE_WALL }]
    } else {
      painting = true
      paintAt(wpos.x, wpos.y)
    }
  }
  canvas.onmousemove = ev => {
    const wpos = screenToWorld(cam, ev.clientX, ev.clientY, canvas)
    if (drag) {
      const e = nearestEdge(wpos.x, wpos.y)
      // lock axis to start dir
      if (drag.start.dir === 'N') e.y = drag.start.y
      else e.x = drag.start.x
      e.dir = drag.start.dir
      drag.cur = e
      const kind = tool === 'door' ? EDGE_DOOR : tool === 'window' ? EDGE_WINDOW : EDGE_WALL
      preview = edgeRun(drag.start, drag.cur).map(h => ({ ...h, kind }))
    } else if (painting) {
      paintAt(wpos.x, wpos.y)
    }
  }
  canvas.onmouseup = () => {
    if (drag) {
      const kind = tool === 'door' ? EDGE_DOOR : tool === 'window' ? EDGE_WINDOW : EDGE_WALL
      // door/window: only place on first edge if drag is short, else walls with door at start for door tool
      const run = edgeRun(drag.start, drag.cur)
      if (tool === 'door' || tool === 'window') {
        applyEdge(drag.start, kind)
      } else {
        for (const e of run) applyEdge(e, EDGE_WALL)
      }
      clearVisionCache()
      drag = null
      preview = []
    }
    painting = false
  }
  canvas.onmouseleave = () => { painting = false }

  let last = performance.now()
  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const sp = 12 / cam.zoom
    if (keys.up) { cam.x -= sp * dt; cam.y -= sp * dt }
    if (keys.down) { cam.x += sp * dt; cam.y += sp * dt }
    if (keys.left) { cam.x -= sp * dt; cam.y += sp * dt }
    if (keys.right) { cam.x += sp * dt; cam.y -= sp * dt }
    render(ctx, world, cam, [], '', now, null, cam.x, cam.y, preview)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  setMsg('drag walls · click door/window · floor/roof brush · wasd pan')
  ;(window as any).G = { world, cam }
}
