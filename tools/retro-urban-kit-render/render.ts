// One-time (and re-runnable) offline render pass: converts Kenney "Retro Urban Kit" OBJ
// models into flat isometric PNG sprites matching client/render.ts's furniture-sprite scheme
// (transparent background, 4 yaw rotations, trimmed to opaque bbox).
//
// This is a from-scratch software rasterizer (no GPU/WebGL/Blender needed): it parses the
// .obj/.mtl by hand, projects vertices with the same 2:1 dimetric math the game already uses
// (see shared/world.ts `iso()` and client/render.ts WALL_H), and rasterizes triangles with a
// per-pixel z-buffer so recessed geometry (window/door cutouts) composites correctly.
//
// Run with: npx tsx tools/retro-urban-kit-render/render.ts
// (expects the extracted kit's "Models/OBJ format" folder at KIT_DIR below — see
// client/assets/objects/RETRO_URBAN_KIT.md for how to re-download it.)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { PNG } from 'pngjs'
import { TILE_W, TILE_H } from '../../shared/world.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Where the extracted "kenney_retro-urban-kit.zip" lives. Re-download from
// https://kenney.nl/assets/retro-urban-kit and extract before re-running.
const KIT_DIR = path.resolve(__dirname, '../../tmp_retro_urban_kit/Models/OBJ format')
const OUT_DIR = path.resolve(__dirname, '../../client/assets/objects')

// Render resolution: pixels per full tile width, kept at the game's exact 2:1 ratio
// (TILE_W:TILE_H) so no extra squash constant is needed for these sprites (unlike the
// externally-rendered furniture kit, which needed OBJ_SQUASH to correct a 0.702 source ratio).
const RENDER_TILE_W = 480
const RENDER_TILE_H = RENDER_TILE_W * (TILE_H / TILE_W) // = 240, exact 2:1

const YAW_DEG = 45 // fixed camera yaw so world x/z map onto the tile's (x-z)/(x+z) diamond axes
const PITCH_DEG = 30 // fixed camera pitch; sin(30)=0.5 is exactly what makes the diamond 2:1

const groundKX = RENDER_TILE_W / 2
const groundKY = RENDER_TILE_H / 2
const heightK = groundKX * Math.SQRT2 * Math.cos((PITCH_DEG * Math.PI) / 180)
const depthKY = 0.5 // sin(30deg), weight of world height in the camera-space depth measure
const depthKXZ = Math.cos((YAW_DEG * Math.PI) / 180) * Math.cos((PITCH_DEG * Math.PI) / 180)

type Vec3 = { x: number; y: number; z: number }
type Face = { mtl: string; v: [number, number, number]; t: [number, number, number] }
type Obj = { positions: Vec3[]; uvs: [number, number][]; faces: Face[] }

function parseObj(text: string): Obj {
  const positions: Vec3[] = []
  const uvs: [number, number][] = []
  const faces: Face[] = []
  let mtl = ''
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('v ')) {
      const [x, y, z] = line.slice(2).trim().split(/\s+/).map(Number)
      positions.push({ x, y, z })
    } else if (line.startsWith('vt ')) {
      const [u, v] = line.slice(3).trim().split(/\s+/).map(Number)
      uvs.push([u, v])
    } else if (line.startsWith('usemtl ')) {
      mtl = line.slice(7).trim()
    } else if (line.startsWith('f ')) {
      const parts = line.slice(2).trim().split(/\s+/).map(p => p.split('/'))
      // all faces in this kit are already triangles (3 verts per f line)
      const v = parts.map(p => Number(p[0]) - 1) as [number, number, number]
      const t = parts.map(p => (p[1] ? Number(p[1]) - 1 : -1)) as [number, number, number]
      faces.push({ mtl, v, t })
    }
  }
  return { positions, uvs, faces }
}

function parseMtl(text: string, baseDir: string) {
  const map: Record<string, string> = {}
  let name = ''
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('newmtl ')) name = line.slice(7).trim()
    else if (line.startsWith('map_Kd ')) map[name] = path.join(baseDir, line.slice(7).trim())
  }
  return map
}

const texCache = new Map<string, { width: number; height: number; data: Buffer }>()
function loadTexture(p: string) {
  const key = path.resolve(p)
  let tex = texCache.get(key)
  if (!tex) {
    const png = PNG.sync.read(readFileSync(key))
    tex = { width: png.width, height: png.height, data: png.data }
    texCache.set(key, tex)
  }
  return tex
}

function sampleTexture(tex: { width: number; height: number; data: Buffer }, u: number, v: number) {
  let uu = u % 1
  if (uu < 0) uu += 1
  let vv = v % 1
  if (vv < 0) vv += 1
  const x = Math.min(tex.width - 1, Math.floor(uu * tex.width))
  // OBJ v=0 is the bottom of the texture; PNG row 0 is the top.
  const y = Math.min(tex.height - 1, Math.floor((1 - vv) * tex.height))
  const i = (y * tex.width + x) * 4
  return [tex.data[i], tex.data[i + 1], tex.data[i + 2], tex.data[i + 3]] as const
}

function rotY(p: Vec3, deg: number): Vec3 {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r), s = Math.sin(r)
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c }
}

// Projects a (already yaw-rotated-for-this-sprite-variant) world point to screen pixel
// coordinates plus a monotonic camera-space depth for z-buffering. sx/cy use the exact same
// dimetric formulas as shared/world.ts `iso()` + client/render.ts's height-subtracts-from-y
// convention, so these sprites line up with the rest of the engine's projection by construction.
function project(p: Vec3) {
  const sx = (p.x - p.z) * groundKX
  const groundY = (p.x + p.z) * groundKY
  const cy = groundY - p.y * heightK
  const depth = depthKY * p.y + depthKXZ * (p.x + p.z)
  return { sx, cy, depth }
}

type Vert = { sx: number; cy: number; depth: number; u: number; v: number }

function edge(ax: number, ay: number, bx: number, by: number, px: number, py: number) {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax)
}

function renderRotation(obj: Obj, mtlMap: Record<string, string>, rotDeg: number) {
  const rotated = obj.positions.map(p => rotY(p, rotDeg))
  const projected = rotated.map(project)

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of projected) {
    if (p.sx < minX) minX = p.sx
    if (p.sx > maxX) maxX = p.sx
    if (p.cy < minY) minY = p.cy
    if (p.cy > maxY) maxY = p.cy
  }
  const margin = 8
  const width = Math.ceil(maxX - minX) + margin * 2
  const height = Math.ceil(maxY - minY) + margin * 2
  const offX = margin - minX
  const offY = margin - minY

  const rgba = new Uint8ClampedArray(width * height * 4)
  const depthBuf = new Float64Array(width * height).fill(-Infinity)

  for (const face of obj.faces) {
    const texPath = mtlMap[face.mtl]
    if (!texPath) continue
    const tex = loadTexture(texPath)
    const verts: Vert[] = face.v.map((vi, k) => {
      const proj = projected[vi]
      const ti = face.t[k]
      const uv = ti >= 0 ? obj.uvs[ti] : [0, 0]
      return { sx: proj.sx + offX, cy: proj.cy + offY, depth: proj.depth, u: uv[0], v: uv[1] }
    }) as Vert[]
    const [a, b, c] = verts
    const area = edge(a.sx, a.cy, b.sx, b.cy, c.sx, c.cy)
    if (area === 0) continue
    const minPx = Math.max(0, Math.floor(Math.min(a.sx, b.sx, c.sx)))
    const maxPx = Math.min(width - 1, Math.ceil(Math.max(a.sx, b.sx, c.sx)))
    const minPy = Math.max(0, Math.floor(Math.min(a.cy, b.cy, c.cy)))
    const maxPy = Math.min(height - 1, Math.ceil(Math.max(a.cy, b.cy, c.cy)))
    for (let py = minPy; py <= maxPy; py++) {
      for (let px = minPx; px <= maxPx; px++) {
        const sx = px + 0.5, sy = py + 0.5
        const w0 = edge(b.sx, b.cy, c.sx, c.cy, sx, sy)
        const w1 = edge(c.sx, c.cy, a.sx, a.cy, sx, sy)
        const w2 = edge(a.sx, a.cy, b.sx, b.cy, sx, sy)
        const inside = area > 0 ? (w0 >= 0 && w1 >= 0 && w2 >= 0) : (w0 <= 0 && w1 <= 0 && w2 <= 0)
        if (!inside) continue
        const l0 = w0 / area, l1 = w1 / area, l2 = w2 / area
        const depth = l0 * a.depth + l1 * b.depth + l2 * c.depth
        const idx = py * width + px
        if (depth <= depthBuf[idx]) continue // farther than what's already drawn there
        const u = l0 * a.u + l1 * b.u + l2 * c.u
        const v = l0 * a.v + l1 * b.v + l2 * c.v
        const [r, g, bl, al] = sampleTexture(tex, u, v)
        if (al < 8) continue
        depthBuf[idx] = depth
        const o = idx * 4
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = bl; rgba[o + 3] = al
      }
    }
  }

  return trim(rgba, width, height)
}

function trim(rgba: Uint8ClampedArray, width: number, height: number) {
  let minX = width, maxX = -1, minY = height, maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return { width: 1, height: 1, data: Buffer.alloc(4) }
  const pad = 2
  minX = Math.max(0, minX - pad); maxX = Math.min(width - 1, maxX + pad)
  minY = Math.max(0, minY - pad); maxY = Math.min(height - 1, maxY + pad)
  const outW = maxX - minX + 1, outH = maxY - minY + 1
  const out = Buffer.alloc(outW * outH * 4)
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const srcO = ((y + minY) * width + (x + minX)) * 4
      const dstO = (y * outW + x) * 4
      out[dstO] = rgba[srcO]; out[dstO + 1] = rgba[srcO + 1]
      out[dstO + 2] = rgba[srcO + 2]; out[dstO + 3] = rgba[srcO + 3]
    }
  }
  return { width: outW, height: outH, data: out }
}

function savePng(outPath: string, img: { width: number; height: number; data: Buffer }) {
  const png = new PNG({ width: img.width, height: img.height })
  img.data.copy(png.data)
  writeFileSync(outPath, PNG.sync.write(png))
}

// The ~6-10 model subset chosen for this pass. See RETRO_URBAN_KIT.md for rationale.
const MODELS: { file: string; id: string; desc: string }[] = [
  { file: 'wall-a.obj', id: 'wallPlain', desc: 'plain concrete/brick wall panel' },
  { file: 'wall-a-window.obj', id: 'wallWindow', desc: 'wall panel with a built-in barred window' },
  { file: 'wall-a-door.obj', id: 'wallDoorway', desc: 'wall panel with a doorway + door' },
  { file: 'door-type-a.obj', id: 'doorPanel', desc: 'standalone door panel' },
  { file: 'window-wide-type-a.obj', id: 'windowPanel', desc: 'standalone wide window panel' },
  { file: 'wall-fence.obj', id: 'fencePanel', desc: 'low metal-barred fence panel' },
  { file: 'wall-a-roof-slant.obj', id: 'roofSlant', desc: 'sloped roof-edge panel' },
  { file: 'wall-steps-type-a.obj', id: 'stepsPanel', desc: 'stepped stairs panel' },
]

function main() {
  if (!existsSync(KIT_DIR)) {
    console.error(`Kit not found at ${KIT_DIR}. Re-download/extract it first (see RETRO_URBAN_KIT.md).`)
    process.exit(1)
  }
  mkdirSync(OUT_DIR, { recursive: true })
  for (const m of MODELS) {
    const objPath = path.join(KIT_DIR, m.file)
    const mtlPath = objPath.replace(/\.obj$/, '.mtl')
    const obj = parseObj(readFileSync(objPath, 'utf8'))
    const mtlMap = parseMtl(readFileSync(mtlPath, 'utf8'), KIT_DIR)
    for (let rot = 0; rot < 4; rot++) {
      const img = renderRotation(obj, mtlMap, rot * 90)
      const outPath = path.join(OUT_DIR, `${m.id}_${rot}.png`)
      savePng(outPath, img)
      console.log(`wrote ${outPath} (${img.width}x${img.height})`)
    }
  }
}

main()
