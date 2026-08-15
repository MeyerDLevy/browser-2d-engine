import { PNG } from 'pngjs'
import { emptyCatalog, type Catalog } from '../shared/materials.ts'
import { storeGet, storePut } from './bucket.ts'

export async function loadCatalog(): Promise<Catalog> {
  const buf = await storeGet('catalog.json')
  if (!buf) return emptyCatalog()
  return JSON.parse(buf.toString())
}

export async function saveCatalog(cat: Catalog) {
  await storePut('catalog.json', Buffer.from(JSON.stringify(cat, null, 2)), 'application/json')
}

export function cropCell(sheet: Buffer, tileSize: number, gap: number, c: number, r: number) {
  const png = PNG.sync.read(sheet)
  const out = new PNG({ width: tileSize, height: tileSize })
  const sx = c * (tileSize + gap)
  const sy = r * (tileSize + gap)
  for (let y = 0; y < tileSize; y++) for (let x = 0; x < tileSize; x++) {
    const si = ((sy + y) * png.width + (sx + x)) * 4
    const di = (y * tileSize + x) * 4
    out.data[di] = png.data[si]
    out.data[di + 1] = png.data[si + 1]
    out.data[di + 2] = png.data[si + 2]
    out.data[di + 3] = png.data[si + 3]
  }
  return PNG.sync.write(out)
}
