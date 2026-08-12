import {
  EDGE_DOOR, EDGE_NONE, EDGE_WALL, EDGE_WINDOW,
  GRASS, DIRT, ROAD, WATER, WOOD, MAP_SIZE, MAX_Z, NONE,
  DIR_N, DIR_E, DIR_S, DIR_W,
  makeWorld, serializeMap, worldFromMap,
  setTile, setEdgeN, setEdgeW, setRoof, setStairs, clearStairs, getStairs,
  edgeN, edgeW, packRoof, resolveRoofCorners,
  type World, type MapData,
} from '../shared/world.ts'
import { render, resize, screenToWorld, type Cam, type PreviewEdge } from './render.ts'
import { clearVisionCache } from './vision.ts'

type Tool = 'wall' | 'door' | 'window' | 'floor' | 'roof' | 'slope' | 'stairs' | 'erase'
type EdgeHit = { x: number; y: number; dir: 'N' | 'W' }

const FLOORS = [
  { id: GRASS, name: 'grass' },
  { id: DIRT, name: 'dirt' },
  { id: ROAD, name: 'road' },
  { id: WATER, name: 'water' },
  { id: WOOD, name: 'wood' },
]

const DIR_NAMES = ['N', 'E', 'S', 'W']

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
      <div id="eb-level">
        <button id="eb-z-down">[</button>
        <span id="eb-z-label">level 0</span>
        <button id="eb-z-up">]</button>
      </div>
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
      #eb-tools, #eb-floors, #eb-save, #eb-level { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
      #eb-msg { width: 100%; color: #888; }
      #eb-z-label { min-width: 70px; text-align: center; }
    `
    document.head.appendChild(style)
  }
  bar.style.display = 'flex'

  const toolsEl = document.getElementById('eb-tools')
  const floorsEl = document.getElementById('eb-floors')
  const msgEl = document.getElementById('eb-msg')
  const zLabel = document.getElementById('eb-z-label')
  const nameEl = document.getElementById('eb-name') as HTMLInputElement
  const mapsEl = document.getElementById('eb-maps') as HTMLSelectElement

  let tool: Tool = 'wall'
  let floorType = WOOD
  let editZ = 0
  let stairDir = DIR_N
  let world: World = makeWorld(1, MAP_SIZE, false)
  const cam: Cam = { x: MAP_SIZE / 2, y: MAP_SIZE / 2, zoom: 0.8 }
  const keys = { up: false, down: false, left: false, right: false }
  let drag: { start: EdgeHit; cur: EdgeHit } = null
  let slopeDrag: { x0: number; y0: number; x1: number; y1: number } = null
  let painting = false
  let preview: PreviewEdge[] = []

  function setMsg(s: string) { msgEl.textContent = s }
  function updateZLabel() { zLabel.textContent = 'level ' + editZ }

  function rebuildTools() {
    const tools: [Tool, string][] = [
      ['wall', 'wall'], ['door', 'door'], ['window', 'window'],
      ['floor', 'floor'], ['roof', 'roof'], ['slope', 'slope'],
      ['stairs', 'stairs'], ['erase', 'erase'],
    ]
    toolsEl.innerHTML = ''
    for (const [id, label] of tools) {
      const b = document.createElement('button')
      b.textContent = id === 'stairs' ? 'stairs ' + DIR_NAMES[stairDir] : label
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
  updateZLabel()

  document.getElementById('eb-z-down').onclick = () => {
    editZ = Math.max(0, editZ - 1)
    updateZLabel()
    clearVisionCache()
  }
  document.getElementById('eb-z-up').onclick = () => {
    editZ = Math.min(MAX_Z - 1, editZ + 1)
    updateZLabel()
    clearVisionCache()
  }

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
    for (let z = 0; z < MAX_Z; z++) resolveRoofCorners(world, z)
    nameEl.value = name
    setMsg('loaded ' + name)
  }

  function nearestEdge(tx: number, ty: number): EdgeHit {
    const fx = tx - Math.floor(tx)
    const fy = ty - Math.floor(ty)
    const ix = Math.floor(tx)
    const iy = Math.floor(ty)
    const dN = fy, dS = 1 - fy, dW = fx, dE = 1 - fx
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
      for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) out.push({ x, y, dir: 'N' })
    } else {
      if (a.x !== b.x) return [a]
      const x = a.x
      for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) out.push({ x, y, dir: 'W' })
    }
    return out
  }

  function applyEdge(e: EdgeHit, kind: number) {
    if (e.dir === 'N') setEdgeN(world, e.x, e.y, kind, editZ)
    else setEdgeW(world, e.x, e.y, kind, editZ)
  }

  function slopeDir(x0: number, y0: number, x1: number, y1: number) {
    if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) return x1 >= x0 ? DIR_E : DIR_W
    return y1 >= y0 ? DIR_S : DIR_N
  }

  function paintSlope(x0: number, y0: number, x1: number, y1: number) {
    const dir = slopeDir(x0, y0, x1, y1)
    const tiles: { x: number; y: number }[] = []
    if (dir === DIR_E || dir === DIR_W) {
      const y = y0
      const a = Math.min(x0, x1), b = Math.max(x0, x1)
      for (let x = a; x <= b; x++) tiles.push({ x, y })
      if (dir === DIR_W) tiles.reverse()
    } else {
      const x = x0
      const a = Math.min(y0, y1), b = Math.max(y0, y1)
      for (let y = a; y <= b; y++) tiles.push({ x, y })
      if (dir === DIR_N) tiles.reverse()
    }
    // step 0 at eave (start of drag in slope-down direction end)
    // slope down = dir, so first tile in reverse of dir has highest step...
    // Plan: step 0 at eave (low), increasing inward. Drag from eave toward ridge.
    tiles.forEach((t, i) => setRoof(world, t.x, t.y, true, editZ, packRoof(dir, i)))
    resolveRoofCorners(world, editZ)
  }

  function paintAt(tx: number, ty: number) {
    const ix = Math.floor(tx), iy = Math.floor(ty)
    if (tool === 'floor') setTile(world, ix, iy, floorType, editZ)
    else if (tool === 'roof') setRoof(world, ix, iy, true, editZ, -1)
    else if (tool === 'stairs') {
      const cur = getStairs(world, ix, iy, editZ)
      if (cur == null) setStairs(world, ix, iy, stairDir, editZ)
      else if (cur === stairDir) {
        stairDir = (stairDir + 1) % 4
        setStairs(world, ix, iy, stairDir, editZ)
        rebuildTools()
      } else setStairs(world, ix, iy, stairDir, editZ)
      setTile(world, ix, iy, WOOD, editZ)
      const d = stairDir === DIR_N ? { dx: 0, dy: -1 }
        : stairDir === DIR_E ? { dx: 1, dy: 0 }
        : stairDir === DIR_S ? { dx: 0, dy: 1 }
        : { dx: -1, dy: 0 }
      if (editZ + 1 < MAX_Z) setTile(world, ix + d.dx, iy + d.dy, WOOD, editZ + 1)
    } else if (tool === 'erase') {
      const e = nearestEdge(tx, ty)
      const cur = e.dir === 'N' ? edgeN(world, e.x, e.y, editZ) : edgeW(world, e.x, e.y, editZ)
      if (cur !== EDGE_NONE) applyEdge(e, EDGE_NONE)
      else if (getStairs(world, ix, iy, editZ) != null) clearStairs(world, ix, iy, editZ)
      else {
        setRoof(world, ix, iy, false, editZ)
        setTile(world, ix, iy, editZ === 0 ? GRASS : NONE, editZ)
        resolveRoofCorners(world, editZ)
      }
    }
    clearVisionCache()
  }

  resize(canvas)
  onresize = () => resize(canvas)

  onkeydown = ev => {
    if ((ev.target as HTMLElement).tagName === 'INPUT') return
    if (ev.code === 'BracketLeft') {
      editZ = Math.max(0, editZ - 1); updateZLabel(); clearVisionCache()
    }
    if (ev.code === 'BracketRight') {
      editZ = Math.min(MAX_Z - 1, editZ + 1); updateZLabel(); clearVisionCache()
    }
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
    const wpos = screenToWorld(cam, ev.clientX, ev.clientY, canvas, editZ)
    if (tool === 'wall' || tool === 'door' || tool === 'window') {
      const e = nearestEdge(wpos.x, wpos.y)
      drag = { start: e, cur: e }
      preview = [{ ...e, kind: tool === 'door' ? EDGE_DOOR : tool === 'window' ? EDGE_WINDOW : EDGE_WALL, z: editZ }]
    } else if (tool === 'slope') {
      const ix = Math.floor(wpos.x), iy = Math.floor(wpos.y)
      slopeDrag = { x0: ix, y0: iy, x1: ix, y1: iy }
    } else {
      painting = true
      paintAt(wpos.x, wpos.y)
    }
  }
  canvas.onmousemove = ev => {
    const wpos = screenToWorld(cam, ev.clientX, ev.clientY, canvas, editZ)
    if (drag) {
      const e = nearestEdge(wpos.x, wpos.y)
      if (drag.start.dir === 'N') e.y = drag.start.y
      else e.x = drag.start.x
      e.dir = drag.start.dir
      drag.cur = e
      const kind = tool === 'door' ? EDGE_DOOR : tool === 'window' ? EDGE_WINDOW : EDGE_WALL
      preview = edgeRun(drag.start, drag.cur).map(h => ({ ...h, kind, z: editZ }))
    } else if (slopeDrag) {
      slopeDrag.x1 = Math.floor(wpos.x)
      slopeDrag.y1 = Math.floor(wpos.y)
    } else if (painting) {
      paintAt(wpos.x, wpos.y)
    }
  }
  canvas.onmouseup = () => {
    if (drag) {
      const kind = tool === 'door' ? EDGE_DOOR : tool === 'window' ? EDGE_WINDOW : EDGE_WALL
      const run = edgeRun(drag.start, drag.cur)
      if (tool === 'door' || tool === 'window') applyEdge(drag.start, kind)
      else for (const e of run) applyEdge(e, EDGE_WALL)
      clearVisionCache()
      drag = null
      preview = []
    }
    if (slopeDrag) {
      paintSlope(slopeDrag.x0, slopeDrag.y0, slopeDrag.x1, slopeDrag.y1)
      clearVisionCache()
      slopeDrag = null
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
    render(ctx, world, cam, [], '', now, null, cam.x, cam.y, preview, editZ, editZ)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  setMsg('[ ] level · slope drag (45°) · corners auto · stairs click/rotate · wasd pan')
  ;(window as any).G = { world, cam, get z() { return editZ } }
}
