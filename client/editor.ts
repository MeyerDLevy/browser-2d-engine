import {
  EDGE_DOOR, EDGE_NONE, EDGE_WALL, EDGE_WINDOW,
  GRASS, DIRT, ROAD, WATER, WOOD, MAP_SIZE, MAX_Z, NONE,
  DIR_N, DIR_E, DIR_S, DIR_W, OBJ_TYPES,
  makeWorld, serializeMap, applyMap, worldFromMap,
  setTile, setEdgeN, setEdgeW, setRoof, setStairs, clearStairs, getStairs,
  edgeN, edgeW, packRoof, packRoofCorner, unpackRoof, resolveRoofCorners, cellKey,
  packObj, setObject, clearObject, objectAt, objFootprint,
  floorSkin, roofSkin, propSkin, edgeSkin,
  type World, type MapData,
} from '../shared/world.ts'
import { render, resize, screenToWorld, type Cam, type PreviewEdge } from './render.ts'
import { clearVisionCache } from './vision.ts'
import { startMaterials } from './materials.ts'
import { tilesFor, emptyCatalog, CATEGORIES, type Catalog, type Category } from '../shared/materials.ts'
import { layoutHouse, stampBuilding, stampTown, stampSidewalk, plotsForBlock, ROOM_MIN, SLOPE } from '../shared/buildings.ts'

type Tool = 'select' | 'wall' | 'door' | 'window' | 'floor' | 'object' | 'roof' | 'slope' | 'stairs' | 'erase'
type EdgeHit = { x: number; y: number; dir: 'N' | 'W' }
type Side = 'N' | 'E' | 'S' | 'W'
type Selection =
  | { type: 'edge'; x: number; y: number; side: Side; edgeKind: number }
  | { type: 'roof'; x: number; y: number; packed: number }
  | { type: 'stairs'; x: number; y: number; dir: number }
  | { type: 'object'; x: number; y: number; typeIdx: number; rot: number }

const FLOORS = [
  { id: GRASS, name: 'grass' },
  { id: DIRT, name: 'dirt' },
  { id: ROAD, name: 'road' },
  { id: WATER, name: 'water' },
  { id: WOOD, name: 'wood' },
]

const DIR_NAMES = ['N', 'E', 'S', 'W']
const SIDES: Side[] = ['N', 'E', 'S', 'W']
const YELLOW = '#ffdd00'
const PALE = '#fff4a8'
const BLUE = '#44aaff'

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
      <div id="eb-mode">
        <button id="eb-map" class="on">map</button>
        <button id="eb-materials">materials</button>
      </div>
      <div id="eb-level">
        <button id="eb-z-down">[</button>
        <span id="eb-z-label">level 0</span>
        <button id="eb-z-up">]</button>
      </div>
      <div id="eb-tools"></div>
      <div id="eb-floors" style="display:none"></div>
      <div id="eb-objects" style="display:none"></div>
      <div id="eb-mats" style="display:none"></div>
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
      #eb-tools, #eb-floors, #eb-objects, #eb-mats, #eb-save, #eb-level, #eb-mode { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
      #eb-objects button.eb-sq, #eb-mats button.eb-sq {
        padding: 2px; width: 40px; height: 40px; line-height: 0;
      }
      .eb-sq img { width: 36px; height: 36px; object-fit: contain; image-rendering: pixelated; background: #111; }
      #eb-picker-bg {
        display: none; position: fixed; inset: 0; z-index: 20; background: #0006;
      }
      #eb-picker {
        position: absolute; top: 56px; left: 12px;
        width: min(560px, calc(100vw - 24px)); max-height: 380px;
        overflow: auto; padding: 8px;
        background: #1a1816; border: 1px solid #666;
        display: flex; flex-wrap: wrap; gap: 4px; align-content: start;
        box-sizing: border-box; z-index: 21;
      }
      #eb-picker button { padding: 2px; width: 40px; height: 40px; }
      #eb-picker img { width: 36px; height: 36px; image-rendering: pixelated; background: #111; }
      #eb-picker .eb-empty { width: 100%; color: #888; font: 13px ui-monospace, Consolas, monospace; }
      #eb-msg { width: 100%; color: #888; }
      #eb-z-label { min-width: 70px; text-align: center; }
    `
    document.head.appendChild(style)
  }
  bar.style.display = 'flex'

  const toolsEl = document.getElementById('eb-tools')
  const floorsEl = document.getElementById('eb-floors')
  const objectsEl = document.getElementById('eb-objects')
  let matsEl = document.getElementById('eb-mats')
  if (!matsEl) {
    matsEl = document.createElement('div')
    matsEl.id = 'eb-mats'
    matsEl.style.display = 'none'
    objectsEl.after(matsEl)
  }
  let pickerBg = document.getElementById('eb-picker-bg')
  if (!pickerBg) {
    pickerBg = document.createElement('div')
    pickerBg.id = 'eb-picker-bg'
    pickerBg.innerHTML = '<div id="eb-picker"></div>'
    document.body.appendChild(pickerBg)
  }
  if (!document.getElementById('eb-picker-css')) {
    const extra = document.createElement('style')
    extra.id = 'eb-picker-css'
    extra.textContent = `
      #eb-objects button.eb-sq, #eb-mats button.eb-sq {
        padding: 2px; width: 40px; height: 40px; line-height: 0;
      }
      .eb-sq img { width: 36px; height: 36px; object-fit: contain; image-rendering: pixelated; background: #111; }
      #eb-picker-bg {
        display: none; position: fixed; inset: 0; z-index: 20; background: #0006;
      }
      #eb-picker {
        position: absolute; top: 56px; left: 12px;
        width: min(560px, calc(100vw - 24px)); max-height: 380px;
        overflow: auto; padding: 8px;
        background: #1a1816; border: 1px solid #666;
        display: flex; flex-wrap: wrap; gap: 4px; align-content: start;
        box-sizing: border-box; z-index: 21;
      }
      #eb-picker button { padding: 2px; width: 40px; height: 40px; }
      #eb-picker img { width: 36px; height: 36px; image-rendering: pixelated; background: #111; }
      #eb-picker .eb-empty { width: 100%; color: #888; font: 13px ui-monospace, Consolas, monospace; }
    `
    document.head.appendChild(extra)
  }
  const pickerEl = document.getElementById('eb-picker')
  const msgEl = document.getElementById('eb-msg')
  const zLabel = document.getElementById('eb-z-label')
  const nameEl = document.getElementById('eb-name') as HTMLInputElement
  const mapsEl = document.getElementById('eb-maps') as HTMLSelectElement

  let tool: Tool = 'select'
  let view: 'map' | 'materials' = 'map'
  let catalog: Catalog = emptyCatalog()
  const mats = startMaterials()
  let floorType = WOOD
  let objType = 0
  let objRot = 0
  let useMatObj = false
  const picked: Partial<Record<Category, string>> = {}
  let editZ = 0
  let stairDir = DIR_N
  let world: World = makeWorld(1, MAP_SIZE, false)
  stampTown(world)
  const cam: Cam = { x: MAP_SIZE / 2, y: MAP_SIZE / 2, zoom: 0.8 }
  const keys = { up: false, down: false, left: false, right: false }
  let drag: { start: EdgeHit; cur: EdgeHit } = null
  let slopeDrag: { x0: number; y0: number; x1: number; y1: number } = null
  let copyDrag: { x1: number; y1: number } = null
  let painting = false
  let selection: Selection = null
  let hover: Selection = null
  let hoverTile: { x: number; y: number } = null
  let hoverEdge: EdgeHit = null
  let preview: PreviewEdge[] = []
  const undo: MapData[] = []
  const UNDO_MAX = 80

  function pushUndo() {
    undo.push(serializeMap(world))
    if (undo.length > UNDO_MAX) undo.shift()
  }

  function doUndo() {
    if (!undo.length) return
    applyMap(world, undo.pop())
    selection = null
    clearHover()
    clearVisionCache()
  }

  function setMsg(s: string) { msgEl.textContent = s }
  function updateZLabel() { zLabel.textContent = 'level ' + editZ }

  function matTool(): Category | null {
    return CATEGORIES.includes(tool as Category) ? tool as Category : null
  }

  function showPickers() {
    const kind = matTool()
    floorsEl.style.display = tool === 'floor' ? 'flex' : 'none'
    objectsEl.style.display = tool === 'object' ? 'flex' : 'none'
    matsEl.style.display = kind && kind !== 'object' ? 'flex' : 'none'
  }

  function closePicker() {
    pickerBg.style.display = 'none'
  }

  function tileThumb(id: string) {
    const img = document.createElement('img')
    img.src = '/materials/tiles/' + id
    img.width = 36
    img.height = 36
    img.style.imageRendering = 'pixelated'
    return img
  }

  function swatchBtn(kind: Category) {
    const b = document.createElement('button')
    b.className = 'eb-sq' + (picked[kind] ? ' on' : '')
    b.title = kind + ' texture'
    if (picked[kind]) b.appendChild(tileThumb(picked[kind]))
    else b.style.background = 'repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 0 0 / 12px 12px'
    b.onclick = ev => {
      ev.stopPropagation()
      openPicker(kind)
    }
    return b
  }

  function openPicker(kind: Category) {
    catalog = mats.catalog
    pickerEl.innerHTML = ''
    const tiles = tilesFor(catalog, kind)
    if (!tiles.length) {
      const s = document.createElement('div')
      s.className = 'eb-empty'
      s.textContent = 'no ' + kind + ' tiles — tag some in materials'
      pickerEl.appendChild(s)
    }
    for (const t of tiles) {
      const b = document.createElement('button')
      b.className = picked[kind] === t.id ? 'on' : ''
      b.title = t.description || t.group + ' ' + t.n
      b.appendChild(tileThumb(t.id))
      b.onclick = ev => {
        ev.stopPropagation()
        picked[kind] = t.id
        if (kind === 'object') useMatObj = true
        closePicker()
        rebuildTools()
      }
      pickerEl.appendChild(b)
    }
    pickerBg.style.display = 'block'
  }
  pickerBg.onclick = () => closePicker()
  pickerEl.onclick = ev => ev.stopPropagation()

  function rebuildTools() {
    const tools: [Tool, string][] = [
      ['select', 'select'],
      ['wall', 'wall'], ['door', 'door'], ['window', 'window'],
      ['floor', 'floor'], ['object', 'object'], ['roof', 'roof'], ['slope', 'slope'],
      ['stairs', 'stairs'], ['erase', 'erase'],
    ]
    toolsEl.innerHTML = ''
    for (const [id, label] of tools) {
      const b = document.createElement('button')
      b.textContent = id === 'stairs' ? 'stairs ' + DIR_NAMES[stairDir] : label
      b.className = tool === id ? 'on' : ''
      b.onclick = () => {
        tool = id
        closePicker()
        rebuildTools()
      }
      toolsEl.appendChild(b)
    }
    floorsEl.innerHTML = ''
    for (const f of FLOORS) {
      const b = document.createElement('button')
      b.textContent = f.name
      b.className = !picked.floor && floorType === f.id ? 'on' : ''
      b.onclick = () => { floorType = f.id; delete picked.floor; rebuildTools() }
      floorsEl.appendChild(b)
    }
    objectsEl.innerHTML = ''
    OBJ_TYPES.forEach((o, i) => {
      const b = document.createElement('button')
      b.className = 'eb-sq' + (!useMatObj && objType === i ? ' on' : '')
      b.title = o.id + (i === objType && !useMatObj ? ' ' + DIR_NAMES[objRot] : '')
      const img = document.createElement('img')
      img.src = `/assets/objects/${o.id}_${i === objType ? objRot : 0}.png`
      b.appendChild(img)
      b.onclick = () => { objType = i; useMatObj = false; delete picked.object; closePicker(); rebuildTools() }
      objectsEl.appendChild(b)
    })
    objectsEl.appendChild(swatchBtn('object'))
    matsEl.innerHTML = ''
    const kind = matTool()
    if (kind && kind !== 'object') matsEl.appendChild(swatchBtn(kind))
    showPickers()
  }
  rebuildTools()
  updateZLabel()

  function setView(v: 'map' | 'materials') {
    view = v
    document.getElementById('eb-map').className = v === 'map' ? 'on' : ''
    document.getElementById('eb-materials').className = v === 'materials' ? 'on' : ''
    const mapBits = ['eb-level', 'eb-tools', 'eb-floors', 'eb-objects', 'eb-mats', 'eb-save']
    for (const id of mapBits) {
      const el = document.getElementById(id)
      if (id === 'eb-floors' || id === 'eb-objects' || id === 'eb-mats') continue
      el.style.display = v === 'map' ? 'flex' : 'none'
    }
    if (v === 'map') {
      catalog = mats.catalog
      rebuildTools()
      canvas.style.display = 'block'
      mats.hide()
      resize(canvas)
    } else {
      floorsEl.style.display = 'none'
      objectsEl.style.display = 'none'
      matsEl.style.display = 'none'
      closePicker()
      canvas.style.display = 'none'
      mats.show().then(() => { catalog = mats.catalog })
    }
  }
  document.getElementById('eb-map').onclick = () => setView('map')
  document.getElementById('eb-materials').onclick = () => setView('materials')
  fetch('/materials').then(r => r.json()).then(c => { catalog = c; rebuildTools() })

  document.getElementById('eb-z-down').onclick = () => {
    editZ = Math.max(0, editZ - 1)
    selection = null
    updateZLabel()
    clearVisionCache()
  }
  document.getElementById('eb-z-up').onclick = () => {
    editZ = Math.min(MAX_Z - 1, editZ + 1)
    selection = null
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
    pushUndo()
    world = makeWorld(1, MAP_SIZE, true)
    selection = null
    clearVisionCache()
    setMsg('blank grass map')
  }
  document.getElementById('eb-town').onclick = () => {
    pushUndo()
    world = makeWorld(1, MAP_SIZE, false)
    stampTown(world)
    selection = null
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
    pushUndo()
    world = worldFromMap(data)
    selection = null
    clearVisionCache()
    for (let z = 0; z < MAX_Z; z++) resolveRoofCorners(world, z)
    nameEl.value = name
    setMsg('loaded ' + name)
  }

  function getSide(x: number, y: number, side: Side) {
    if (side === 'N') return edgeN(world, x, y, editZ)
    if (side === 'W') return edgeW(world, x, y, editZ)
    if (side === 'E') return edgeW(world, x + 1, y, editZ)
    return edgeN(world, x, y + 1, editZ)
  }

  function setSide(x: number, y: number, side: Side, kind: number) {
    if (side === 'N') setEdgeN(world, x, y, kind, editZ)
    else if (side === 'W') setEdgeW(world, x, y, kind, editZ)
    else if (side === 'E') setEdgeW(world, x + 1, y, kind, editZ)
    else setEdgeN(world, x, y + 1, kind, editZ)
  }

  function sideToHit(x: number, y: number, side: Side): EdgeHit {
    if (side === 'N') return { x, y, dir: 'N' }
    if (side === 'W') return { x, y, dir: 'W' }
    if (side === 'E') return { x: x + 1, y, dir: 'W' }
    return { x, y: y + 1, dir: 'N' }
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

  function applyEdge(e: EdgeHit, kind: number, skin?: string) {
    if (e.dir === 'N') setEdgeN(world, e.x, e.y, kind, editZ)
    else setEdgeW(world, e.x, e.y, kind, editZ)
    const k = edgeSkin(e.dir, e.x, e.y, editZ)
    if (kind === EDGE_NONE) world.skins.delete(k)
    else if (skin) world.skins.set(k, skin)
    else if (skin === '') world.skins.delete(k)
    else {
      const id = picked[tool as Category]
      if (id) world.skins.set(k, id)
      else world.skins.delete(k)
    }
  }

  function moveEdgeSkin(from: EdgeHit, to: EdgeHit) {
    const a = edgeSkin(from.dir, from.x, from.y, editZ)
    const b = edgeSkin(to.dir, to.x, to.y, editZ)
    const s = world.skins.get(a)
    world.skins.delete(a)
    if (s) world.skins.set(b, s)
    else world.skins.delete(b)
  }

  function copySkin(fromKey: string, toKey: string) {
    const s = world.skins.get(fromKey)
    if (s) world.skins.set(toKey, s)
    else world.skins.delete(toKey)
  }

  function slopeDir(x0: number, y0: number, x1: number, y1: number) {
    if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) return x1 >= x0 ? DIR_E : DIR_W
    return y1 >= y0 ? DIR_S : DIR_N
  }

  function slopeTiles(x0: number, y0: number, x1: number, y1: number) {
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
    return { dir, tiles }
  }

  function paintSlope(x0: number, y0: number, x1: number, y1: number) {
    const { dir, tiles } = slopeTiles(x0, y0, x1, y1)
    tiles.forEach((t, i) => {
      setRoof(world, t.x, t.y, true, editZ, packRoof(dir, i))
      const k = roofSkin(t.x, t.y, editZ)
      if (picked.slope) world.skins.set(k, picked.slope)
      else world.skins.delete(k)
    })
    resolveRoofCorners(world, editZ)
  }

  function copyLine(x0: number, y0: number, x1: number, y1: number) {
    const tiles: { x: number; y: number }[] = []
    if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) {
      const y = y0
      const a = Math.min(x0, x1), b = Math.max(x0, x1)
      for (let x = a; x <= b; x++) tiles.push({ x, y })
    } else {
      const x = x0
      const a = Math.min(y0, y1), b = Math.max(y0, y1)
      for (let y = a; y <= b; y++) tiles.push({ x, y })
    }
    return tiles
  }

  function tryHit(tx: number, ty: number): Selection | null {
    const ix = Math.floor(tx), iy = Math.floor(ty)
    const fx = tx - ix, fy = ty - iy
    const dN = fy, dS = 1 - fy, dW = fx, dE = 1 - fx
    const m = Math.min(dN, dS, dW, dE)
    let side: Side = 'N'
    if (m === dS) side = 'S'
    else if (m === dW) side = 'W'
    else if (m === dE) side = 'E'
    if (m < 0.28) {
      const kind = getSide(ix, iy, side)
      if (kind !== EDGE_NONE) return { type: 'edge', x: ix, y: iy, side, edgeKind: kind }
    }
    const stair = getStairs(world, ix, iy, editZ)
    if (stair != null) return { type: 'stairs', x: ix, y: iy, dir: stair }
    const obj = objectAt(world, ix, iy, editZ)
    if (obj) return { type: 'object', x: obj.ax, y: obj.ay, typeIdx: obj.typeIdx, rot: obj.rot }
    const k = cellKey(ix, iy, editZ)
    if (world.roofs.has(k)) return { type: 'roof', x: ix, y: iy, packed: world.roofs.get(k) }
    return null
  }

  /** Footprint is placeable: no other object covers any of its tiles. */
  function objFits(ax: number, ay: number, typeIdx: number, rot: number, ignoreAnchor?: { x: number; y: number }) {
    for (const t of objFootprint(ax, ay, typeIdx, rot)) {
      const o = objectAt(world, t.x, t.y, editZ)
      if (o && !(ignoreAnchor && o.ax === ignoreAnchor.x && o.ay === ignoreAnchor.y)) return false
    }
    return true
  }

  function rotateSelection() {
    if (!selection) return
    if (selection.type === 'roof' && unpackRoof(selection.packed).flat) return
    if (selection.type === 'object') {
      const next = (selection.rot + 1) % 4
      if (!objFits(selection.x, selection.y, selection.typeIdx, next, { x: selection.x, y: selection.y })) return
      pushUndo()
      setObject(world, selection.x, selection.y, selection.typeIdx, next, editZ)
      selection = { ...selection, rot: next }
      clearVisionCache()
      return
    }
    pushUndo()
    if (selection.type === 'edge') {
      const i = SIDES.indexOf(selection.side)
      const next = SIDES[(i + 1) % 4]
      const from = sideToHit(selection.x, selection.y, selection.side)
      const to = sideToHit(selection.x, selection.y, next)
      setSide(selection.x, selection.y, selection.side, EDGE_NONE)
      setSide(selection.x, selection.y, next, selection.edgeKind)
      moveEdgeSkin(from, to)
      selection = { ...selection, side: next }
    } else if (selection.type === 'stairs') {
      const next = (selection.dir + 1) % 4
      setStairs(world, selection.x, selection.y, next, editZ)
      selection = { ...selection, dir: next }
      stairDir = next
      rebuildTools()
    } else {
      const u = unpackRoof(selection.packed)
      if (!u.flat) {
        const packed = u.corner
          ? packRoofCorner((u.dir + 1) % 4, u.step)
          : packRoof((u.dir + 1) % 4, u.step)
        setRoof(world, selection.x, selection.y, true, editZ, packed)
        selection = { ...selection, packed }
      }
    }
    clearVisionCache()
  }

  function paintAt(tx: number, ty: number) {
    const ix = Math.floor(tx), iy = Math.floor(ty)
    if (tool === 'floor') {
      setTile(world, ix, iy, floorType, editZ)
      const k = floorSkin(ix, iy, editZ)
      if (picked.floor) world.skins.set(k, picked.floor)
      else world.skins.delete(k)
    }
    else if (tool === 'object') {
      if (useMatObj && picked.object) {
        world.skins.set(propSkin(ix, iy, editZ), picked.object)
      } else if (objFits(ix, iy, objType, objRot)) {
        world.skins.delete(propSkin(ix, iy, editZ))
        setObject(world, ix, iy, objType, objRot, editZ)
      }
    }
    else if (tool === 'roof') {
      setRoof(world, ix, iy, true, editZ, -1)
      const k = roofSkin(ix, iy, editZ)
      if (picked.roof) world.skins.set(k, picked.roof)
      else world.skins.delete(k)
    }
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
      const obj = objectAt(world, ix, iy, editZ)
      const pk = propSkin(ix, iy, editZ)
      if (cur !== EDGE_NONE) applyEdge(e, EDGE_NONE)
      else if (obj) clearObject(world, obj.ax, obj.ay, editZ)
      else if (world.skins.has(pk)) world.skins.delete(pk)
      else if (getStairs(world, ix, iy, editZ) != null) clearStairs(world, ix, iy, editZ)
      else {
        setRoof(world, ix, iy, false, editZ)
        world.skins.delete(roofSkin(ix, iy, editZ))
        setTile(world, ix, iy, editZ === 0 ? GRASS : NONE, editZ)
        world.skins.delete(floorSkin(ix, iy, editZ))
        resolveRoofCorners(world, editZ)
      }
      if (selection && selection.x === ix && selection.y === iy) selection = null
    }
    clearVisionCache()
  }

  function tileOutline(x: number, y: number, color: string, ground = false): PreviewEdge {
    return { x, y, z: editZ, color, tile: true, ground }
  }

  function sameSel(a: Selection, b: Selection) {
    if (!a || !b || a.type !== b.type || a.x !== b.x || a.y !== b.y) return false
    if (a.type === 'edge' && b.type === 'edge') return a.side === b.side
    return true
  }

  function selHighlights(s: Selection, color: string): PreviewEdge[] {
    if (s.type === 'edge') {
      const hit = sideToHit(s.x, s.y, s.side)
      return [{ ...hit, kind: s.edgeKind, z: editZ, color }]
    }
    if (s.type === 'object') {
      return objFootprint(s.x, s.y, s.typeIdx, s.rot).map(t => tileOutline(t.x, t.y, color, true))
    }
    return [tileOutline(s.x, s.y, color)]
  }

  function clearHover() {
    hover = null
    hoverTile = null
    hoverEdge = null
  }

  function updateHover(tx: number, ty: number) {
    if (tool === 'erase') { clearHover(); return }
    hover = tryHit(tx, ty)
    hoverTile = null
    hoverEdge = null
    if ((tool === 'door' || tool === 'window') && hover && hover.type === 'edge') {
      hoverEdge = sideToHit(hover.x, hover.y, hover.side)
      hover = null
    }
    if (hover || tool === 'select') return
    hoverTile = { x: Math.floor(tx), y: Math.floor(ty) }
    if (tool === 'wall' || tool === 'door' || tool === 'window') {
      if (!hoverEdge) hoverEdge = nearestEdge(tx, ty)
    }
  }

  function placeKind() {
    if (tool === 'door') return EDGE_DOOR
    if (tool === 'window') return EDGE_WINDOW
    return EDGE_WALL
  }

  function buildPreview(): PreviewEdge[] {
    const out: PreviewEdge[] = []
    if (hoverTile) {
      out.push(tileOutline(hoverTile.x, hoverTile.y, PALE, tool === 'floor' || tool === 'object'))
      if (tool === 'floor') out.push({ x: hoverTile.x, y: hoverTile.y, z: editZ, ghost: true, floor: floorType, mat: picked.floor })
      if (tool === 'object') {
        if (useMatObj && picked.object) out.push({ x: hoverTile.x, y: hoverTile.y, z: editZ, ghost: true, mat: picked.object, prop: true })
        else out.push({ x: hoverTile.x, y: hoverTile.y, z: editZ, ghost: true, obj: packObj(objType, objRot) })
      }
      if (tool === 'roof') out.push({ x: hoverTile.x, y: hoverTile.y, z: editZ, ghost: true, roof: -1, mat: picked.roof })
      if (tool === 'stairs') out.push({ x: hoverTile.x, y: hoverTile.y, z: editZ, ghost: true, stairs: stairDir })
      if (tool === 'slope') out.push({ x: hoverTile.x, y: hoverTile.y, z: editZ, ghost: true, roof: packRoof(DIR_S, 0), mat: picked.slope })
    }
    if (hoverEdge) out.push({ ...hoverEdge, kind: placeKind(), z: editZ, ghost: true, mat: picked[tool as Category] })
    if (hover && !sameSel(hover, selection)) out.push(...selHighlights(hover, PALE))
    if (selection) out.push(...selHighlights(selection, YELLOW))
    if (copyDrag && selection) {
      const tiles = copyLine(selection.x, selection.y, copyDrag.x1, copyDrag.y1)
      for (const t of tiles) {
        if (t.x === selection.x && t.y === selection.y) continue
        if (selection.type === 'edge') {
          const hit = sideToHit(t.x, t.y, selection.side)
          out.push({ ...hit, kind: selection.edgeKind, z: editZ, color: BLUE })
        } else if (selection.type === 'object') {
          out.push({ x: t.x, y: t.y, z: editZ, ghost: true, obj: packObj(selection.typeIdx, selection.rot) })
          out.push(tileOutline(t.x, t.y, BLUE, true))
        } else {
          out.push(tileOutline(t.x, t.y, BLUE))
        }
      }
    }
    if (drag) {
      for (const h of edgeRun(drag.start, drag.cur)) {
        out.push({ ...h, kind: placeKind(), z: editZ, ghost: true, mat: picked[tool as Category] })
      }
    }
    if (slopeDrag) {
      const { dir, tiles } = slopeTiles(slopeDrag.x0, slopeDrag.y0, slopeDrag.x1, slopeDrag.y1)
      tiles.forEach((t, i) => out.push({ x: t.x, y: t.y, z: editZ, ghost: true, roof: packRoof(dir, i), mat: picked.slope }))
    }
    return out
  }

  resize(canvas)
  onresize = () => { resize(canvas); mats.layout() }

  onkeydown = ev => {
    if ((ev.target as HTMLElement).tagName === 'INPUT') return
    if (ev.code === 'Escape' && pickerBg.style.display === 'block') {
      closePicker()
      ev.preventDefault()
      return
    }
    if (ev.code === 'BracketLeft') {
      editZ = Math.max(0, editZ - 1); selection = null; updateZLabel(); clearVisionCache()
    }
    if (ev.code === 'BracketRight') {
      editZ = Math.min(MAX_Z - 1, editZ + 1); selection = null; updateZLabel(); clearVisionCache()
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyZ') {
      doUndo()
      ev.preventDefault()
      return
    }
    if (ev.code === 'KeyR') {
      if (selection) rotateSelection()
      else if (tool === 'object') { objRot = (objRot + 1) % 4; rebuildTools() }
      ev.preventDefault()
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
    if (tool === 'door' || tool === 'window') {
      const hit = tryHit(wpos.x, wpos.y)
      if (hit && hit.type === 'edge') {
        pushUndo()
        applyEdge(sideToHit(hit.x, hit.y, hit.side), placeKind())
        clearVisionCache()
        return
      }
    }
    if (tool !== 'erase') {
      const hit = tryHit(wpos.x, wpos.y)
      if (hit) {
        selection = hit
        copyDrag = { x1: hit.x, y1: hit.y }
        return
      }
    }
    selection = null
    copyDrag = null
    if (tool === 'select') return
    if (tool === 'wall' || tool === 'door' || tool === 'window') {
      const e = nearestEdge(wpos.x, wpos.y)
      drag = { start: e, cur: e }
    } else if (tool === 'slope') {
      const ix = Math.floor(wpos.x), iy = Math.floor(wpos.y)
      slopeDrag = { x0: ix, y0: iy, x1: ix, y1: iy }
    } else {
      painting = true
      pushUndo()
      paintAt(wpos.x, wpos.y)
    }
  }
  canvas.onmousemove = ev => {
    const wpos = screenToWorld(cam, ev.clientX, ev.clientY, canvas, editZ)
    if (copyDrag && selection) {
      copyDrag.x1 = Math.floor(wpos.x)
      copyDrag.y1 = Math.floor(wpos.y)
      clearHover()
    } else if (drag) {
      const e = nearestEdge(wpos.x, wpos.y)
      if (drag.start.dir === 'N') e.y = drag.start.y
      else e.x = drag.start.x
      e.dir = drag.start.dir
      drag.cur = e
      clearHover()
    } else if (slopeDrag) {
      slopeDrag.x1 = Math.floor(wpos.x)
      slopeDrag.y1 = Math.floor(wpos.y)
      clearHover()
    } else if (painting) {
      paintAt(wpos.x, wpos.y)
      clearHover()
    } else {
      updateHover(wpos.x, wpos.y)
    }
  }
  canvas.onmouseup = () => {
    if (copyDrag && selection) {
      const tiles = copyLine(selection.x, selection.y, copyDrag.x1, copyDrag.y1)
      const extra = tiles.filter(t => t.x !== selection.x || t.y !== selection.y)
      if (extra.length) {
        pushUndo()
        for (const t of extra) {
          if (selection.type === 'edge') {
            const src = sideToHit(selection.x, selection.y, selection.side)
            const dst = sideToHit(t.x, t.y, selection.side)
            setSide(t.x, t.y, selection.side, selection.edgeKind)
            copySkin(edgeSkin(src.dir, src.x, src.y, editZ), edgeSkin(dst.dir, dst.x, dst.y, editZ))
          }
          else if (selection.type === 'stairs') {
            setStairs(world, t.x, t.y, selection.dir, editZ)
            setTile(world, t.x, t.y, WOOD, editZ)
          } else if (selection.type === 'object') {
            if (objFits(t.x, t.y, selection.typeIdx, selection.rot)) {
              setObject(world, t.x, t.y, selection.typeIdx, selection.rot, editZ)
            }
          } else {
            setRoof(world, t.x, t.y, true, editZ, selection.packed)
            copySkin(roofSkin(selection.x, selection.y, editZ), roofSkin(t.x, t.y, editZ))
          }
        }
        if (selection.type === 'roof') resolveRoofCorners(world, editZ)
        clearVisionCache()
      }
      copyDrag = null
    }
    if (drag) {
      pushUndo()
      const run = edgeRun(drag.start, drag.cur)
      if (tool === 'door' || tool === 'window') applyEdge(drag.start, placeKind())
      else for (const e of run) applyEdge(e, EDGE_WALL)
      clearVisionCache()
      drag = null
    }
    if (slopeDrag) {
      pushUndo()
      paintSlope(slopeDrag.x0, slopeDrag.y0, slopeDrag.x1, slopeDrag.y1)
      clearVisionCache()
      slopeDrag = null
    }
    painting = false
  }
  canvas.onmouseleave = () => { painting = false; clearHover() }

  let last = performance.now()
  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const sp = 12 / cam.zoom
    if (keys.up) { cam.x -= sp * dt; cam.y -= sp * dt }
    if (keys.down) { cam.x += sp * dt; cam.y += sp * dt }
    if (keys.left) { cam.x -= sp * dt; cam.y += sp * dt }
    if (keys.right) { cam.x += sp * dt; cam.y -= sp * dt }
    preview = buildPreview()
    if (view === 'map') render(ctx, world, cam, [], '', now, null, cam.x, cam.y, preview, editZ, editZ)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  setMsg('click any placed object to select · R rotate · drag copy · ctrl+z undo · [ ] level · wasd pan')
  ;(window as any).G = {
    get world() { return world },
    cam,
    get z() { return editZ },
    get sel() { return selection },
    get catalog() { return catalog },
    tilesFor: (k) => tilesFor(catalog, k),
    picked,
    ROOM_MIN,
    SLOPE,
    layoutHouse,
    stampBuilding,
    stampTown,
    stampHouse: (ox: number, oy: number, seed = 1, maxW = 10, maxH = 10, front: 'N' | 'E' | 'S' | 'W' = 'S') => {
      const b = layoutHouse(seed, maxW, maxH, front)
      const door = stampBuilding(world, ox, oy, editZ, b, true, seed)
      if (door) stampSidewalk(world, door, editZ)
      clearVisionCache()
      return b
    },
    fillTown: () => { stampTown(world); clearVisionCache() },
    plotsForBlock,
  }
}
