export type Category = 'wall' | 'roof' | 'slope' | 'floor'
export const CATEGORIES: Category[] = ['wall', 'roof', 'slope', 'floor']

export type TileGroup = { name: string; color: string; cells: { c: number; r: number }[] }

export type Tilemap = {
  id: string
  file: string
  tileSize: number
  gap: number
  groups: TileGroup[]
}

export type Tile = {
  id: string
  group: string
  n: number
  tilemapId: string
  c: number
  r: number
  file: string
  description: string
  categories: Category[]
}

export type Catalog = { tilemaps: Tilemap[]; tiles: Tile[] }

export function emptyCatalog(): Catalog {
  return { tilemaps: [], tiles: [] }
}

export function tilesFor(cat: Catalog, kind: Category) {
  return cat.tiles.filter(t => t.categories.includes(kind))
}

export const GROUP_COLORS = ['#e07040', '#44aaff', '#5d5', '#dd4', '#c68', '#6ac', '#fa4', '#a7f']
