import {
  EDGE_DOOR, EDGE_NONE, EDGE_WALL, EDGE_WINDOW,
  NONE, TILE_COLOR, TILE_H, TILE_W, ROOF_RISE, DIR_N, DIR_E, DIR_S, DIR_W,
  CORNER_NE, CORNER_SE, CORNER_SW, CORNER_NW,
  edgeN, edgeW, getTile, getRoof, getStairs, iso, screenToTile, type World,
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
  ctx.fillStyle = TILE_COLOR[t] || '#444'
  ctx.fill()
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
  const side = kind === EDGE_WINDOW ? '#4a6a78' : kind === EDGE_DOOR ? '#5c3a22' : '#4a3a30'
  const top = kind === EDGE_WINDOW ? '#8ab4c8' : '#6b5344'
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.lineTo(b.x, b.y - h)
  ctx.lineTo(a.x, a.y - h)
  ctx.closePath()
  ctx.fillStyle = side
  ctx.fill()
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
    const mid = 0.35
    ctx.beginPath()
    ctx.moveTo(a.x, a.y - h * mid)
    ctx.lineTo(b.x, b.y - h * mid)
    ctx.lineTo(b.x, b.y - h * 0.75)
    ctx.lineTo(a.x, a.y - h * 0.75)
    ctx.closePath()
    ctx.fillStyle = '#a8d0e8aa'
    ctx.fill()
  }
  if (kind === EDGE_DOOR && h > 10) {
    const t0 = 0.28, t1 = 0.72
    const ax = a.x + (b.x - a.x) * t0
    const ay = a.y + (b.y - a.y) * t0
    const bx = a.x + (b.x - a.x) * t1
    const by = a.y + (b.y - a.y) * t1
    ctx.beginPath()
    ctx.moveTo(ax, ay - 1)
    ctx.lineTo(bx, by - 1)
    ctx.lineTo(bx, by - h + 6)
    ctx.lineTo(ax, ay - h + 6)
    ctx.closePath()
    ctx.fillStyle = '#1a1a18'
    ctx.fill()
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

function drawStairs(ctx: CanvasRenderingContext2D, w: World, tx: number, ty: number, z: number, seen: boolean, dim: number) {
  const dir = getStairs(w, tx, ty, z)
  if (dir == null || !seen) return
  const p = iso(tx, ty)
  const base = levelY(z)
  ctx.globalAlpha = dim
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

function drawRoofTile(ctx: CanvasRenderingContext2D, w: World, tx: number, ty: number, z: number, underRoof: boolean, dim: number) {
  if (underRoof) return
  const roof = getRoof(w, tx, ty, z)
  if (!roof) return
  const base = levelY(z)
  ctx.globalAlpha = dim
  if (roof.flat) {
    const p = iso(tx, ty)
    diamond(ctx, p.x, p.y - base - WALL_H)
    ctx.fillStyle = '#5a4030cc'
    ctx.fill()
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
      // outer hip: low at eave corner, high at opposite (ridge)
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
    ctx.fillStyle = roof.corner ? '#7a5538dd' : '#6a4a30dd'
    ctx.fill()
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

export type DrawEnt = { e: Entity; x: number; y: number; moving?: boolean }
export type PreviewEdge = { x: number; y: number; dir: 'N' | 'W'; kind: number; z?: number }

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
      const nw = iso(pe.x, pe.y); nw.y -= base
      const ne = iso(pe.x + 1, pe.y); ne.y -= base
      const sw = iso(pe.x, pe.y + 1); sw.y -= base
      if (pe.dir === 'N') drawEdgeSeg(ctx, nw, ne, WALL_H, pe.kind || EDGE_WALL, 0.7)
      else drawEdgeSeg(ctx, nw, sw, WALL_H, pe.kind || EDGE_WALL, 0.7)
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
