import {
  EDGE_DOOR, EDGE_NONE, EDGE_WALL, EDGE_WINDOW,
  NONE, TILE_COLOR, TILE_H, TILE_W, ROOF_RISE, DIR_N, DIR_E, DIR_S, DIR_W,
  CORNER_NE, CORNER_SE, CORNER_SW, CORNER_NW, OBJ_TYPES,
  edgeN, edgeW, getTile, getRoof, getStairs, unpackRoof, unpackObj,
  objectAt, objFootprint, iso, screenToTile, type World,
} from '../shared/world.ts'
import { ITEM_COLOR, type Entity } from '../shared/entities.ts'

export type Cam = { x: number; y: number; zoom: number }

const FRAME = 128
const SCALE = 0.85
const FEET_X = 64
const FEET_Y = 96
export const WALL_H = 44
export const LEVEL_H = WALL_H
const CUT_H = 4
const ANIMS = {
  stance: { col: 0, frames: 4, ms: 800, loop: 'pong' as const },
  run: { col: 4, frames: 8, ms: 533, loop: 'loop' as const },
  swing: { col: 12, frames: 4, ms: 400, loop: 'once' as const },
  die: { col: 18, frames: 6, ms: 800, loop: 'once' as const },
}

const heroImg = new Image()
heroImg.src = '/assets/hero.png'
const headImg = new Image()
headImg.src = '/assets/head.png'

function loadTex(name: string) {
  const im = new Image()
  im.src = `/assets/tex/${name}.png`
  return im
}
const texFloor = [loadTex('grass'), loadTex('dirt'), loadTex('road'), loadTex('water'), loadTex('wood')]
const texWall = loadTex('wall')
const texRoof = loadTex('roof')
const texDoor = loadTex('door')
const texWindow = loadTex('window')

// Kenney Furniture Kit sprites, one per type per rotation (0=NE 1=SE 2=SW 3=NW facing)
const objImgs = OBJ_TYPES.map(o => [0, 1, 2, 3].map(r => {
  const im = new Image()
  im.src = `/assets/objects/${o.id}_${r}.png`
  return im
}))
// how much of its footprint's iso width each piece visually fills
const OBJ_FILL: Record<string, number> = {
  fridge: 0.8,
  crate: 0.7,
  chair: 0.62,
  toilet: 0.62,
  couch: 1,
  bed: 0.85,
  table: 0.95,
}
// Kenney art's ground diamond is height:width 0.702, ours is TILE_H/TILE_W=0.5;
// only the diamond (roof + base point) needs re-ratioing, not the vertical wall drop below it
const KENNEY_DIAMOND_RATIO = 0.702

const animClock = new Map<string, { anim: string; t0: number }>()

function ready(img: HTMLImageElement) {
  return img.complete && img.naturalWidth > 0
}

function dirRow(facing: number) {
  const q = Math.round(facing / (Math.PI / 4))
  return ((q + 6) % 8 + 8) % 8
}

function animFrame(id: string, anim: string, now: number) {
  const spec = ANIMS[anim]
  let c = animClock.get(id)
  if (!c || c.anim !== anim) {
    c = { anim, t0: now }
    animClock.set(id, c)
  }
  const n = spec.frames
  const t = now - c.t0
  if (spec.loop === 'once') return Math.min(n - 1, Math.floor(t / (spec.ms / n)))
  if (spec.loop === 'pong') {
    const cycle = n * 2 - 2
    const i = Math.floor(t / (spec.ms / n)) % cycle
    return i < n ? i : cycle - i
  }
  return Math.floor(t / (spec.ms / n)) % n
}

function blit(ctx: CanvasRenderingContext2D, img: HTMLImageElement, col: number, row: number, px: number, py: number) {
  const dw = FRAME * SCALE
  const dh = FRAME * SCALE
  ctx.drawImage(
    img,
    col * FRAME, row * FRAME, FRAME, FRAME,
    px - FEET_X * SCALE, py - FEET_Y * SCALE, dw, dh,
  )
}

export function resize(c: HTMLCanvasElement) {
  const dpr = devicePixelRatio || 1
  c.width = innerWidth * dpr
  c.height = innerHeight * dpr
  c.style.width = innerWidth + 'px'
  c.style.height = innerHeight + 'px'
}

function diamond(ctx: CanvasRenderingContext2D, ox: number, oy: number) {
  ctx.beginPath()
  ctx.moveTo(ox, oy)
  ctx.lineTo(ox + TILE_W / 2, oy + TILE_H / 2)
  ctx.lineTo(ox, oy + TILE_H)
  ctx.lineTo(ox - TILE_W / 2, oy + TILE_H / 2)
  ctx.closePath()
}

function fillTex(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  o: { x: number; y: number },
  u: { x: number; y: number },
  v: { x: number; y: number },
  doClip = true,
) {
  if (!ready(img)) return false
  ctx.save()
  if (doClip) {
    ctx.beginPath()
    ctx.moveTo(o.x, o.y)
    ctx.lineTo(o.x + u.x, o.y + u.y)
    ctx.lineTo(o.x + u.x + v.x, o.y + u.y + v.y)
    ctx.lineTo(o.x + v.x, o.y + v.y)
    ctx.closePath()
    ctx.clip()
  }
  ctx.imageSmoothingEnabled = false
  ctx.transform(u.x / img.naturalWidth, u.y / img.naturalWidth, v.x / img.naturalHeight, v.y / img.naturalHeight, o.x, o.y)
  ctx.drawImage(img, 0, 0)
  ctx.restore()
  return true
}

function prismAt(ctx: CanvasRenderingContext2D, px: number, py: number, h: number, top: string, side: string) {
  const L = { x: px - TILE_W / 2, y: py + TILE_H / 2 }
  const R = { x: px + TILE_W / 2, y: py + TILE_H / 2 }
  ctx.beginPath()
  ctx.moveTo(L.x, L.y - h)
  ctx.lineTo(px, py - h)
  ctx.lineTo(px, py)
  ctx.lineTo(L.x, L.y)
  ctx.closePath()
  ctx.fillStyle = side
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(R.x, R.y - h)
  ctx.lineTo(px, py - h)
  ctx.lineTo(px, py)
  ctx.lineTo(R.x, R.y)
  ctx.closePath()
  ctx.fillStyle = '#00000022'
  ctx.fill()
  ctx.fillStyle = side
  ctx.globalAlpha *= 0.85
  ctx.fill()
  ctx.globalAlpha /= 0.85
  diamond(ctx, px, py - h)
  ctx.fillStyle = top
  ctx.fill()
  ctx.strokeStyle = '#00000033'
  ctx.lineWidth = 0.6
  ctx.stroke()
}

function prism(ctx: CanvasRenderingContext2D, tx: number, ty: number, h: number, top: string, side: string, zOff = 0) {
  const p = iso(tx, ty)
  prismAt(ctx, p.x, p.y - zOff, h, top, side)
}

function cutNear(tx: number, ty: number, px: number, py: number) {
  const dx = tx - px
  const dy = ty - py
  return tx + ty > px + py && dx * dx + dy * dy < 36
}

function levelY(z: number) {
  return z * LEVEL_H
}

function drawFloor(ctx: CanvasRenderingContext2D, w: World, tx: number, ty: number, z: number, seen: boolean, dim: number) {
  const t = getTile(w, tx, ty, z)
  if (t === NONE) return
  const p = iso(tx, ty)
  const oy = p.y - levelY(z)
  diamond(ctx, p.x, oy)
  ctx.globalAlpha = dim
  if (!seen) {
    ctx.fillStyle = '#0a0a0a'
    ctx.fill()
    ctx.globalAlpha = 1
    return
  }
  const img = texFloor[t]
  const o = { x: p.x, y: oy }
  const u = { x: TILE_W / 2, y: TILE_H / 2 }
  const v = { x: -TILE_W / 2, y: TILE_H / 2 }
  if (!img || !fillTex(ctx, img, o, u, v)) {
    ctx.fillStyle = TILE_COLOR[t] || '#444'
    ctx.fill()
  }
  diamond(ctx, p.x, oy)
  ctx.strokeStyle = '#00000022'
  ctx.lineWidth = 0.5
  ctx.stroke()
  ctx.globalAlpha = 1
}

function drawEdgeSeg(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  h: number,
  kind: number,
  alpha: number,
) {
  if (kind === EDGE_NONE) return
  const prev = ctx.globalAlpha
  ctx.globalAlpha = alpha * prev
  const top = kind === EDGE_WINDOW ? '#8ab4c8' : '#6b5344'
  const o = { x: a.x, y: a.y }
  const u = { x: b.x - a.x, y: b.y - a.y }
  const v = { x: 0, y: -h }
  if (!fillTex(ctx, texWall, o, u, v)) {
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.lineTo(b.x, b.y - h)
    ctx.lineTo(a.x, a.y - h)
    ctx.closePath()
    ctx.fillStyle = kind === EDGE_WINDOW ? '#4a6a78' : kind === EDGE_DOOR ? '#5c3a22' : '#4a3a30'
    ctx.fill()
  }
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.lineTo(b.x, b.y - h)
  ctx.lineTo(a.x, a.y - h)
  ctx.closePath()
  ctx.strokeStyle = '#00000044'
  ctx.lineWidth = 0.6
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(a.x, a.y - h)
  ctx.lineTo(b.x, b.y - h)
  ctx.strokeStyle = top
  ctx.lineWidth = 2
  ctx.stroke()
  if (kind === EDGE_WINDOW && h > 10) {
    const t0 = 0.22, t1 = 0.78
    const o2 = { x: a.x + u.x * t0, y: a.y + u.y * t0 - h * 0.32 }
    const u2 = { x: u.x * (t1 - t0), y: u.y * (t1 - t0) }
    const v2 = { x: 0, y: -h * 0.45 }
    if (!fillTex(ctx, texWindow, o2, u2, v2)) {
      ctx.beginPath()
      ctx.moveTo(o2.x, o2.y)
      ctx.lineTo(o2.x + u2.x, o2.y + u2.y)
      ctx.lineTo(o2.x + u2.x, o2.y + u2.y + v2.y)
      ctx.lineTo(o2.x, o2.y + v2.y)
      ctx.closePath()
      ctx.fillStyle = '#a8d0e8aa'
      ctx.fill()
    }
  }
  if (kind === EDGE_DOOR && h > 10) {
    const t0 = 0.22, t1 = 0.78
    const o2 = { x: a.x + u.x * t0, y: a.y + u.y * t0 - 1 }
    const u2 = { x: u.x * (t1 - t0), y: u.y * (t1 - t0) }
    const v2 = { x: 0, y: -h + 6 }
    if (!fillTex(ctx, texDoor, o2, u2, v2)) {
      ctx.beginPath()
      ctx.moveTo(o2.x, o2.y)
      ctx.lineTo(o2.x + u2.x, o2.y + u2.y)
      ctx.lineTo(o2.x + u2.x, o2.y + u2.y + v2.y)
      ctx.lineTo(o2.x, o2.y + v2.y)
      ctx.closePath()
      ctx.fillStyle = '#1a1a18'
      ctx.fill()
    }
  }
  ctx.globalAlpha = prev
}

function drawEdges(
  ctx: CanvasRenderingContext2D,
  w: World,
  tx: number, ty: number, z: number,
  seen: boolean, px: number, py: number, dim: number,
) {
  if (!seen) return
  const cut = cutNear(tx, ty, px, py)
  const h = cut ? CUT_H : WALL_H
  const alpha = (cut ? 0.35 : 1) * dim
  const base = levelY(z)
  const nw = iso(tx, ty); nw.y -= base
  const ne = iso(tx + 1, ty); ne.y -= base
  const sw = iso(tx, ty + 1); sw.y -= base
  const n = edgeN(w, tx, ty, z)
  if (n) drawEdgeSeg(ctx, nw, ne, h, n, alpha)
  const ww = edgeW(w, tx, ty, z)
  if (ww) drawEdgeSeg(ctx, nw, sw, h, ww, alpha)
}

function drawStairsAt(ctx: CanvasRenderingContext2D, tx: number, ty: number, z: number, dir: number, alpha: number) {
  const base = levelY(z)
  ctx.globalAlpha = alpha
  const steps = 4
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps
    let ox = 0, oy = 0
    if (dir === DIR_N) { ox = 0; oy = -t }
    else if (dir === DIR_E) { ox = t; oy = 0 }
    else if (dir === DIR_S) { ox = 0; oy = t }
    else { ox = -t; oy = 0 }
    const sp = iso(tx + 0.5 + ox * 0.4, ty + 0.5 + oy * 0.4)
    const h = (i + 1) * (LEVEL_H / steps)
    ctx.fillStyle = '#7a6a4a'
    ctx.fillRect(sp.x - 10, sp.y - base - h, 20, 4)
  }
  ctx.globalAlpha = 1
}

function drawStairs(ctx: CanvasRenderingContext2D, w: World, tx: number, ty: number, z: number, seen: boolean, dim: number) {
  const dir = getStairs(w, tx, ty, z)
  if (dir == null || !seen) return
  drawStairsAt(ctx, tx, ty, z, dir, dim)
}

function drawRoofShape(ctx: CanvasRenderingContext2D, tx: number, ty: number, z: number, roof: ReturnType<typeof unpackRoof>, alpha: number) {
  const base = levelY(z)
  ctx.globalAlpha = alpha
  if (roof.flat) {
    const p = iso(tx, ty)
    const oy = p.y - base - WALL_H
    const o = { x: p.x, y: oy }
    const u = { x: TILE_W / 2, y: TILE_H / 2 }
    const v = { x: -TILE_W / 2, y: TILE_H / 2 }
    diamond(ctx, p.x, oy)
    if (!fillTex(ctx, texRoof, o, u, v)) {
      ctx.fillStyle = '#5a4030cc'
      ctx.fill()
    }
    diamond(ctx, p.x, oy)
    ctx.strokeStyle = '#00000033'
    ctx.lineWidth = 0.5
    ctx.stroke()
  } else {
    const h0 = base + WALL_H + roof.step * ROOF_RISE
    const h1 = h0 + ROOF_RISE
    const nw = iso(tx, ty)
    const ne = iso(tx + 1, ty)
    const se = iso(tx + 1, ty + 1)
    const sw = iso(tx, ty + 1)
    let hNW = h1, hNE = h1, hSE = h1, hSW = h1
    if (roof.corner) {
      if (roof.dir === CORNER_SW) { hSW = h0; hSE = h0; hNW = h0; hNE = h1 }
      else if (roof.dir === CORNER_SE) { hSE = h0; hSW = h0; hNE = h0; hNW = h1 }
      else if (roof.dir === CORNER_NW) { hNW = h0; hNE = h0; hSW = h0; hSE = h1 }
      else if (roof.dir === CORNER_NE) { hNE = h0; hNW = h0; hSE = h0; hSW = h1 }
    } else {
      hNW = roof.dir === DIR_N || roof.dir === DIR_W ? h0 : h1
      hNE = roof.dir === DIR_N || roof.dir === DIR_E ? h0 : h1
      hSE = roof.dir === DIR_S || roof.dir === DIR_E ? h0 : h1
      hSW = roof.dir === DIR_S || roof.dir === DIR_W ? h0 : h1
    }
    const pts = [
      { x: nw.x, y: nw.y - hNW },
      { x: ne.x, y: ne.y - hNE },
      { x: se.x, y: se.y - hSE },
      { x: sw.x, y: sw.y - hSW },
    ]
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    ctx.lineTo(pts[1].x, pts[1].y)
    ctx.lineTo(pts[2].x, pts[2].y)
    ctx.lineTo(pts[3].x, pts[3].y)
    ctx.closePath()
    ctx.save()
    ctx.clip()
    const o = pts[0]
    const u = { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y }
    const v = { x: pts[3].x - pts[0].x, y: pts[3].y - pts[0].y }
    if (!fillTex(ctx, texRoof, o, u, v, false)) {
      ctx.fillStyle = roof.corner ? '#7a5538dd' : '#6a4a30dd'
      ctx.fill()
    }
    ctx.restore()
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    ctx.lineTo(pts[1].x, pts[1].y)
    ctx.lineTo(pts[2].x, pts[2].y)
    ctx.lineTo(pts[3].x, pts[3].y)
    ctx.closePath()
    ctx.strokeStyle = '#00000044'
    ctx.lineWidth = 0.6
    ctx.stroke()
    if (roof.corner) {
      ctx.beginPath()
      if (roof.dir === CORNER_SW) { ctx.moveTo(sw.x, sw.y - hSW); ctx.lineTo(ne.x, ne.y - hNE) }
      else if (roof.dir === CORNER_SE) { ctx.moveTo(se.x, se.y - hSE); ctx.lineTo(nw.x, nw.y - hNW) }
      else if (roof.dir === CORNER_NW) { ctx.moveTo(nw.x, nw.y - hNW); ctx.lineTo(se.x, se.y - hSE) }
      else { ctx.moveTo(ne.x, ne.y - hNE); ctx.lineTo(sw.x, sw.y - hSW) }
      ctx.strokeStyle = '#00000055'
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1
}

function drawRoofTile(ctx: CanvasRenderingContext2D, w: World, tx: number, ty: number, z: number, underRoof: boolean, dim: number) {
  if (underRoof) return
  const roof = getRoof(w, tx, ty, z)
  if (!roof) return
  drawRoofShape(ctx, tx, ty, z, roof, dim)
}

export function drawObjectBox(ctx: CanvasRenderingContext2D, ax: number, ay: number, z: number, typeIdx: number, rot: number, alpha: number) {
  const spec = OBJ_TYPES[typeIdx]
  if (!spec) return
  const fp = objFootprint(ax, ay, typeIdx, rot)
  let mx = ax + 1, my = ay + 1
  for (const t of fp) { mx = Math.max(mx, t.x + 1); my = Math.max(my, t.y + 1) }
  const base = levelY(z)
  const img = objImgs[typeIdx][rot]
  if (ready(img)) {
    const c = iso((ax + mx) / 2, (ay + my) / 2)
    const span = mx - ax + my - ay
    // scale so the sprite fills its share of the footprint's iso width
    const dw = OBJ_FILL[spec.id] * span * (TILE_W / 2)
    // wall drop is already true screen-vertical pixels; only its diamond needs re-ratioing
    const wallPx = img.naturalHeight - img.naturalWidth * KENNEY_DIAMOND_RATIO
    const dh = dw * (TILE_H / TILE_W) + wallPx * (dw / img.naturalWidth)
    // the footprint's south vertex sits this far below its centre, regardless of fill
    const foot = c.y - base + span * (TILE_H / 4)
    const prev = ctx.globalAlpha
    ctx.globalAlpha = alpha
    ctx.drawImage(img, c.x - dw / 2, foot - dh, dw, dh)
    ctx.globalAlpha = prev
    return
  }
  const inset = 0.12
  const h = spec.height
  const nw = iso(ax + inset, ay + inset); nw.y -= base
  const ne = iso(mx - inset, ay + inset); ne.y -= base
  const se = iso(mx - inset, my - inset); se.y -= base
  const sw = iso(ax + inset, my - inset); sw.y -= base
  const prev = ctx.globalAlpha
  ctx.globalAlpha = alpha
  const face = (a: { x: number; y: number }, b: { x: number; y: number }, shade: string) => {
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.lineTo(b.x, b.y - h)
    ctx.lineTo(a.x, a.y - h)
    ctx.closePath()
    ctx.fillStyle = spec.color
    ctx.fill()
    ctx.fillStyle = shade
    ctx.fill()
  }
  face(sw, se, '#00000044')
  face(se, ne, '#00000066')
  ctx.beginPath()
  ctx.moveTo(nw.x, nw.y - h)
  ctx.lineTo(ne.x, ne.y - h)
  ctx.lineTo(se.x, se.y - h)
  ctx.lineTo(sw.x, sw.y - h)
  ctx.closePath()
  ctx.fillStyle = spec.color
  ctx.fill()
  ctx.strokeStyle = '#00000055'
  ctx.lineWidth = 0.6
  ctx.stroke()
  ctx.globalAlpha = prev
}

function drawObjectTile(ctx: CanvasRenderingContext2D, w: World, tx: number, ty: number, z: number, seen: boolean, dim: number) {
  if (!seen) return
  const o = objectAt(w, tx, ty, z)
  if (!o) return
  // draw once, when the sweep reaches the footprint's deepest tile
  const fp = objFootprint(o.ax, o.ay, o.typeIdx, o.rot)
  let best = fp[0]
  for (const t of fp) {
    if (t.x + t.y > best.x + best.y || (t.x + t.y === best.x + best.y && t.x > best.x)) best = t
  }
  if (tx !== best.x || ty !== best.y) return
  drawObjectBox(ctx, o.ax, o.ay, z, o.typeIdx, o.rot, dim)
}

export type DrawEnt = { e: Entity; x: number; y: number; moving?: boolean }
export type PreviewEdge = {
  x: number
  y: number
  dir?: 'N' | 'W'
  kind?: number
  z?: number
  color?: string
  tile?: boolean
  ground?: boolean
  ghost?: boolean
  floor?: number
  stairs?: number
  roof?: number
  obj?: number
}

function drawPlayer(ctx: CanvasRenderingContext2D, d: DrawEnt, now: number, dim: number) {
  const { e, x, y } = d
  const z = e.z || 0
  const p = iso(x, y)
  const oy = p.y - levelY(z)
  ctx.globalAlpha = dim
  ctx.fillStyle = e.color || '#e07040'
  ctx.beginPath()
  ctx.ellipse(p.x, oy + 4, 10, 5, 0, 0, Math.PI * 2)
  ctx.globalAlpha = 0.45 * dim
  ctx.fill()
  ctx.globalAlpha = dim
  const anim = e.dead ? 'die' : (e.attackCd > 0 ? 'swing' : (d.moving ? 'run' : 'stance'))
  if (ready(heroImg)) {
    const row = dirRow(e.facing)
    const col = ANIMS[anim].col + animFrame(e.id, anim, now)
    blit(ctx, heroImg, col, row, p.x, oy)
    if (ready(headImg)) blit(ctx, headImg, col, row, p.x, oy)
  } else {
    prismAt(ctx, p.x, oy, e.dead ? 4 : 12, e.dead ? '#444' : (e.color || '#e07040'), '#222')
  }
  const top = oy - FEET_Y * SCALE
  ctx.fillStyle = '#eee'
  ctx.font = '11px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.fillText(e.name || '', p.x, top - 6)
  if (!e.dead) {
    const hp = (e.health || 0) / (e.maxHealth || 100)
    ctx.fillStyle = '#000'
    ctx.fillRect(p.x - 14, top + 2, 28, 4)
    ctx.fillStyle = hp > 0.4 ? '#5d5' : '#d44'
    ctx.fillRect(p.x - 14, top + 2, 28 * hp, 4)
  }
  ctx.globalAlpha = 1
}

function drawEntity(ctx: CanvasRenderingContext2D, d: DrawEnt, meId: string, now: number, myZ: number) {
  const { e, x, y } = d
  const ez = e.z || 0
  const dim = ez === myZ ? 1 : 0.45
  const p = iso(x, y)
  const oy = p.y - levelY(ez)
  if (e.kind === 'item') {
    ctx.globalAlpha = dim
    diamond(ctx, p.x, oy + 8)
    ctx.fillStyle = ITEM_COLOR[e.itemType] || '#ccc'
    ctx.fill()
    ctx.globalAlpha = 1
    return
  }
  if (e.kind === 'vehicle') {
    ctx.globalAlpha = dim
    prism(ctx, x - 0.35, y - 0.15, 10, e.driverId ? '#8b2020' : '#2a3a6a', '#1a1528', levelY(ez))
    ctx.globalAlpha = 1
    return
  }
  if (e.vehicleId) return
  drawPlayer(ctx, d, now, dim)
}

export function render(
  ctx: CanvasRenderingContext2D,
  world: World,
  cam: Cam,
  ents: DrawEnt[],
  meId: string,
  now = performance.now(),
  vis: Set<string> = null,
  px = 0,
  py = 0,
  preview: PreviewEdge[] = null,
  myZ = 0,
  maxDrawZ: number = null,
) {
  const { canvas } = ctx
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#1a1a18'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const z = cam.zoom * (devicePixelRatio || 1)
  ctx.setTransform(z, 0, 0, z, canvas.width / 2, canvas.height / 2)
  const origin = iso(cam.x, cam.y)
  // shift camera vertically for player level so they stay centered
  ctx.translate(-origin.x, -origin.y + levelY(myZ) * 0.35)

  const hw = canvas.width / 2 / z
  const hh = canvas.height / 2 / z
  const corners = [
    screenToTile(origin.x - hw, origin.y - hh),
    screenToTile(origin.x + hw, origin.y - hh),
    screenToTile(origin.x - hw, origin.y + hh),
    screenToTile(origin.x + hw, origin.y + hh),
  ]
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const c of corners) {
    if (c.x < minX) minX = c.x
    if (c.x > maxX) maxX = c.x
    if (c.y < minY) minY = c.y
    if (c.y > maxY) maxY = c.y
  }
  minX = Math.floor(minX) - 1
  maxX = Math.ceil(maxX) + 2
  minY = Math.floor(minY) - 1
  maxY = Math.ceil(maxY) + 2

  const ix = Math.floor(px)
  const iy = Math.floor(py)
  const topZ = maxDrawZ != null ? maxDrawZ : myZ
  const underRoof = !!getRoof(world, px, py, myZ)

  for (let lz = 0; lz <= topZ; lz++) {
    const dim = lz < myZ ? 0.55 : 1
    const useVis = lz === myZ ? vis : null
    for (let sum = minX + minY; sum <= maxX + maxY; sum++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const ty = sum - tx
        if (ty < minY || ty > maxY) continue
        const seen = !useVis || useVis.has(tx + ',' + ty)
        drawFloor(ctx, world, tx, ty, lz, seen || lz < myZ, dim)
        drawObjectTile(ctx, world, tx, ty, lz, seen || lz < myZ, dim)
        drawEdges(ctx, world, tx, ty, lz, seen || lz < myZ, ix, iy, dim)
        drawStairs(ctx, world, tx, ty, lz, seen || lz < myZ, dim)
      }
    }
    // entities on this level interleaved by depth
    const levelEnts = ents.filter(d => (d.e.z || 0) === lz)
    levelEnts.sort((a, b) => a.x + a.y - (b.x + b.y))
    for (const d of levelEnts) {
      if (vis && lz === myZ && d.e.id !== meId && !vis.has(Math.floor(d.x) + ',' + Math.floor(d.y))) continue
      if (lz > myZ) continue
      drawEntity(ctx, d, meId, now, myZ)
    }
  }

  // roofs for levels <= myZ
  for (let lz = 0; lz <= topZ; lz++) {
    const dim = lz < myZ ? 0.55 : 1
    const hide = underRoof && lz === myZ
    for (let sum = minX + minY; sum <= maxX + maxY; sum++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const ty = sum - tx
        if (ty < minY || ty > maxY) continue
        drawRoofTile(ctx, world, tx, ty, lz, hide, dim)
      }
    }
  }

  if (preview) {
    for (const pe of preview) {
      const pz = pe.z || 0
      const base = levelY(pz)
      if (pe.ghost && pe.floor != null) {
        const p = iso(pe.x, pe.y)
        const oy = p.y - base
        diamond(ctx, p.x, oy)
        ctx.globalAlpha = 0.3
        const img = texFloor[pe.floor]
        const o = { x: p.x, y: oy }
        const u = { x: TILE_W / 2, y: TILE_H / 2 }
        const v = { x: -TILE_W / 2, y: TILE_H / 2 }
        if (!img || !fillTex(ctx, img, o, u, v)) {
          ctx.fillStyle = TILE_COLOR[pe.floor] || '#444'
          ctx.fill()
        }
        ctx.globalAlpha = 1
        continue
      }
      if (pe.ghost && pe.roof != null) {
        drawRoofShape(ctx, pe.x, pe.y, pz, unpackRoof(pe.roof), 0.3)
        continue
      }
      if (pe.ghost && pe.stairs != null) {
        drawStairsAt(ctx, pe.x, pe.y, pz, pe.stairs, 0.3)
        continue
      }
      if (pe.ghost && pe.obj != null) {
        const o = unpackObj(pe.obj)
        drawObjectBox(ctx, pe.x, pe.y, pz, o.typeIdx, o.rot, 0.3)
        continue
      }
      if (pe.tile) {
        const p = iso(pe.x, pe.y)
        diamond(ctx, p.x, p.y - base - (pe.ground ? 0 : WALL_H))
        ctx.strokeStyle = pe.color || '#ffdd00'
        ctx.lineWidth = 3
        ctx.stroke()
        continue
      }
      const nw = iso(pe.x, pe.y); nw.y -= base
      const ne = iso(pe.x + 1, pe.y); ne.y -= base
      const sw = iso(pe.x, pe.y + 1); sw.y -= base
      const a = nw
      const b = pe.dir === 'N' ? ne : sw
      if (pe.ghost) {
        drawEdgeSeg(ctx, a, b, WALL_H, pe.kind || EDGE_WALL, 0.3)
      } else if (pe.color) {
        const h = WALL_H
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.lineTo(b.x, b.y - h)
        ctx.lineTo(a.x, a.y - h)
        ctx.closePath()
        ctx.strokeStyle = pe.color
        ctx.lineWidth = 3
        ctx.stroke()
      } else {
        drawEdgeSeg(ctx, a, b, WALL_H, pe.kind || EDGE_WALL, 0.3)
      }
    }
  }
}

export function screenToWorld(cam: Cam, sx: number, sy: number, canvas: HTMLCanvasElement, myZ = 0) {
  const z = cam.zoom * (devicePixelRatio || 1)
  const ox = (sx * (devicePixelRatio || 1) - canvas.width / 2) / z
  const oy = (sy * (devicePixelRatio || 1) - canvas.height / 2) / z
  const origin = iso(cam.x, cam.y)
  return screenToTile(origin.x + ox, origin.y + oy - levelY(myZ) * 0.35)
}
