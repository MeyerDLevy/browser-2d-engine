import {
  TILE_COLOR, TILE_H, TILE_SIDE, TILE_W, WALL, getTile, iso, screenToTile, type World,
} from '../shared/world.ts'
import { ITEM_COLOR, type Entity } from '../shared/entities.ts'

export type Cam = { x: number; y: number; zoom: number }

const FRAME = 128
const SCALE = 0.55
const FEET_X = 64
const FEET_Y = 96
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

function prism(ctx: CanvasRenderingContext2D, tx: number, ty: number, h: number, top: string, side: string) {
  const p = iso(tx, ty)
  const L = { x: p.x - TILE_W / 2, y: p.y + TILE_H / 2 }
  const R = { x: p.x + TILE_W / 2, y: p.y + TILE_H / 2 }
  const B = { x: p.x, y: p.y + TILE_H }
  ctx.beginPath()
  ctx.moveTo(L.x, L.y - h)
  ctx.lineTo(p.x, p.y - h)
  ctx.lineTo(p.x, p.y)
  ctx.lineTo(L.x, L.y)
  ctx.closePath()
  ctx.fillStyle = side
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(R.x, R.y - h)
  ctx.lineTo(p.x, p.y - h)
  ctx.lineTo(p.x, p.y)
  ctx.lineTo(R.x, R.y)
  ctx.closePath()
  ctx.fillStyle = '#00000022'
  ctx.fill()
  ctx.fillStyle = side
  ctx.globalAlpha = 0.85
  ctx.fill()
  ctx.globalAlpha = 1
  diamond(ctx, p.x, p.y - h)
  ctx.fillStyle = top
  ctx.fill()
  ctx.strokeStyle = '#00000033'
  ctx.lineWidth = 0.6
  ctx.stroke()
}

function drawTile(ctx: CanvasRenderingContext2D, w: World, tx: number, ty: number) {
  const t = getTile(w, tx, ty)
  const top = TILE_COLOR[t]
  const side = TILE_SIDE[t]
  if (t === WALL) {
    prism(ctx, tx, ty, 18, top, side)
    return
  }
  const p = iso(tx, ty)
  diamond(ctx, p.x, p.y)
  ctx.fillStyle = top
  ctx.fill()
  ctx.strokeStyle = '#00000022'
  ctx.lineWidth = 0.5
  ctx.stroke()
}

export type DrawEnt = { e: Entity; x: number; y: number; moving?: boolean }

function drawPlayer(ctx: CanvasRenderingContext2D, d: DrawEnt, now: number) {
  const { e, x, y } = d
  const p = iso(x, y)
  ctx.fillStyle = e.color || '#e07040'
  ctx.beginPath()
  ctx.ellipse(p.x, p.y + 4, 10, 5, 0, 0, Math.PI * 2)
  ctx.globalAlpha = 0.45
  ctx.fill()
  ctx.globalAlpha = 1
  const anim = e.dead ? 'die' : (e.attackCd > 0 ? 'swing' : (d.moving ? 'run' : 'stance'))
  if (ready(heroImg)) {
    const row = dirRow(e.facing)
    const col = ANIMS[anim].col + animFrame(e.id, anim, now)
    blit(ctx, heroImg, col, row, p.x, p.y)
    if (ready(headImg)) blit(ctx, headImg, col, row, p.x, p.y)
  } else {
    prism(ctx, x, y, e.dead ? 4 : 12, e.dead ? '#444' : (e.color || '#e07040'), '#222')
  }
  const top = p.y - FEET_Y * SCALE
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
}

function drawEntity(ctx: CanvasRenderingContext2D, d: DrawEnt, meId: string, now: number) {
  const { e, x, y } = d
  const p = iso(x, y)
  if (e.kind === 'item') {
    diamond(ctx, p.x, p.y + 8)
    ctx.fillStyle = ITEM_COLOR[e.itemType] || '#ccc'
    ctx.fill()
    return
  }
  if (e.kind === 'vehicle') {
    prism(ctx, x - 0.35, y - 0.15, 10, e.driverId ? '#8b2020' : '#2a3a6a', '#1a1528')
    return
  }
  if (e.vehicleId) return
  drawPlayer(ctx, d, now)
}

export function render(
  ctx: CanvasRenderingContext2D,
  world: World,
  cam: Cam,
  ents: DrawEnt[],
  meId: string,
  now = performance.now(),
) {
  const { canvas } = ctx
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#1a1a18'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const z = cam.zoom * (devicePixelRatio || 1)
  ctx.setTransform(z, 0, 0, z, canvas.width / 2, canvas.height / 2)
  const origin = iso(cam.x, cam.y)
  ctx.translate(-origin.x, -origin.y)

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

  for (let sum = minX + minY; sum <= maxX + maxY; sum++) {
    for (let tx = minX; tx <= maxX; tx++) {
      const ty = sum - tx
      if (ty < minY || ty > maxY) continue
      drawTile(ctx, world, tx, ty)
    }
  }

  ents.sort((a, b) => a.x + a.y - (b.x + b.y))
  for (const d of ents) drawEntity(ctx, d, meId, now)
}
