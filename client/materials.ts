import { CATEGORIES, GROUP_COLORS, emptyCatalog, type Catalog, type Category, type Tile, type Tilemap } from '../shared/materials.ts'

export function startMaterials() {
  let cat: Catalog = emptyCatalog()
  let tab: 'tiles' | 'tilemaps' = 'tilemaps'
  let tm: Tilemap = null
  let tile: Tile = null
  let sheet: HTMLImageElement = null
  let sel = new Set<string>()
  let box: { c0: number; r0: number; c1: number; r1: number } = null
  let zoom = 3

  const wrap = document.createElement('div')
  wrap.id = 'mat'
  wrap.innerHTML = `
    <div id="mat-side">
      <div id="mat-tabs">
        <button data-tab="tiles">Tiles</button>
        <button data-tab="tilemaps" class="on">Tilemaps</button>
      </div>
      <div id="mat-list"></div>
      <div id="mat-add"></div>
    </div>
    <canvas id="mat-cv"></canvas>
    <div id="mat-insp"></div>
  `
  const style = document.createElement('style')
  style.textContent = `
    #mat { display: none; position: absolute; top: 48px; left: 0; right: 0; bottom: 0; z-index: 4; background: #1a1a18; }
    #mat.on { display: flex; }
    #mat-side { width: 220px; background: #161410; border-right: 1px solid #333; display: flex; flex-direction: column; }
    #mat-tabs { display: flex; }
    #mat-tabs button { flex: 1; font: 13px ui-monospace, Consolas, monospace; background: #2a2824; color: #eee; border: 1px solid #555; padding: 8px; }
    #mat-tabs button.on { background: #5a4030; }
    #mat-list { flex: 1; overflow: auto; padding: 8px; }
    #mat-add { padding: 8px; border-top: 1px solid #333; }
    .mat-item { display: flex; gap: 8px; align-items: center; padding: 6px; cursor: pointer; border: 1px solid transparent; }
    .mat-item.on { border-color: #8a6a50; background: #2a241c; }
    .mat-item img { width: 32px; height: 32px; image-rendering: pixelated; background: #000; }
    #mat-cv { flex: 1; min-width: 0; display: block; background: #111; cursor: crosshair; }
    #mat-insp { width: 260px; background: #161410; border-left: 1px solid #333; padding: 12px; overflow: auto; font: 13px ui-monospace, Consolas, monospace; color: #ddd; }
    #mat-insp label { display: block; color: #888; margin: 10px 0 4px; }
    #mat-insp input[type=text], #mat-insp input[type=number], #mat-insp textarea {
      width: 100%; box-sizing: border-box; background: #141310; color: #eee; border: 1px solid #444; padding: 5px 8px; font: inherit;
    }
    #mat-insp textarea { height: 80px; }
    #mat-insp button { font: inherit; background: #2a2824; color: #eee; border: 1px solid #555; padding: 5px 8px; margin-top: 8px; }
    #mat-insp .chk { display: block; margin: 4px 0; color: #ddd; }
  `
  document.head.appendChild(style)
  document.body.appendChild(wrap)

  const listEl = wrap.querySelector('#mat-list') as HTMLElement
  const addEl = wrap.querySelector('#mat-add') as HTMLElement
  const insp = wrap.querySelector('#mat-insp') as HTMLElement
  const cv = wrap.querySelector('#mat-cv') as HTMLCanvasElement
  const ctx = cv.getContext('2d')

  wrap.querySelectorAll('#mat-tabs button').forEach((b: HTMLButtonElement) => {
    b.onclick = () => {
      tab = b.dataset.tab as any
      wrap.querySelectorAll('#mat-tabs button').forEach(x => x.classList.toggle('on', x === b))
      sel.clear(); tm = null; tile = null; sheet = null
      refresh()
    }
  })

  async function load() {
    cat = await (await fetch('/materials')).json()
  }

  async function saveCat() {
    await fetch('/materials', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cat) })
  }

  function cellKey(c: number, r: number) { return c + ',' + r }

  function grid() {
    if (!sheet || !tm) return { cols: 0, rows: 0, stride: 0 }
    const stride = tm.tileSize + tm.gap
    return {
      cols: Math.floor((sheet.naturalWidth + tm.gap) / stride),
      rows: Math.floor((sheet.naturalHeight + tm.gap) / stride),
      stride,
    }
  }

  function atCell(mx: number, my: number) {
    const g = grid()
    const c = Math.floor(mx / (g.stride * zoom))
    const r = Math.floor(my / (g.stride * zoom))
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return null
    return { c, r }
  }

  function refresh() {
    listEl.innerHTML = ''
    addEl.innerHTML = ''
    if (tab === 'tilemaps') {
      for (const t of cat.tilemaps) {
        const row = document.createElement('div')
        row.className = 'mat-item' + (tm && tm.id === t.id ? ' on' : '')
        row.innerHTML = `<img src="/materials/tilemaps/${t.id}"> <span>${t.id}</span>`
        row.onclick = () => pickMap(t)
        listEl.appendChild(row)
      }
      addEl.innerHTML = `<input type="file" accept="image/png" id="mat-file">`
      const inp = addEl.querySelector('#mat-file') as HTMLInputElement
      inp.onchange = async () => {
        const f = inp.files[0]
        if (!f) return
        const id = f.name.replace(/\.png$/i, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 32)
        await fetch('/materials/tilemaps/' + id, { method: 'POST', body: await f.arrayBuffer() })
        await load()
        pickMap(cat.tilemaps.find(x => x.id === id))
      }
    } else {
      for (const t of cat.tiles) {
        const row = document.createElement('div')
        row.className = 'mat-item' + (tile && tile.id === t.id ? ' on' : '')
        row.innerHTML = `<img src="/materials/tiles/${t.id}"> <span>${t.group}_${t.n}</span>`
        row.onclick = () => pickTile(t)
        listEl.appendChild(row)
      }
    }
    drawInsp()
    draw()
  }

  function pickMap(t: Tilemap) {
    tm = t
    tile = null
    sel.clear()
    sheet = new Image()
    sheet.onload = () => { drawInsp(); draw() }
    sheet.src = '/materials/tilemaps/' + t.id + '?' + Date.now()
    refresh()
  }

  function pickTile(t: Tile) {
    tile = t
    tm = cat.tilemaps.find(x => x.id === t.tilemapId)
    sel.clear()
    refresh()
  }

  function drawInsp() {
    if (tab === 'tilemaps' && tm) {
      insp.innerHTML = `
        <div>${tm.id}</div>
        <label>tile size (px)</label>
        <input type="number" id="mat-size" value="${tm.tileSize}" min="1">
        <label>gap (px)</label>
        <input type="number" id="mat-gap" value="${tm.gap}" min="0">
        <label>group name</label>
        <input type="text" id="mat-gname" placeholder="required">
        <button id="mat-group">group selected</button>
        <div id="mat-selcount" style="margin-top:8px;color:#888"></div>
      `
      const size = insp.querySelector('#mat-size') as HTMLInputElement
      const gap = insp.querySelector('#mat-gap') as HTMLInputElement
      size.onchange = async () => { tm.tileSize = +size.value; await saveCat(); draw() }
      gap.onchange = async () => { tm.gap = +gap.value; await saveCat(); draw() }
      const btn = insp.querySelector('#mat-group') as HTMLButtonElement
      const nameEl = insp.querySelector('#mat-gname') as HTMLInputElement
      const count = () => { (insp.querySelector('#mat-selcount') as HTMLElement).textContent = sel.size + ' cells selected' }
      count()
      btn.onclick = async () => {
        const name = nameEl.value.trim()
        if (!name || !sel.size) return
        const color = GROUP_COLORS[tm.groups.length % GROUP_COLORS.length]
        const cells = [...sel].map(k => { const [c, r] = k.split(',').map(Number); return { c, r } })
        cat = await (await fetch('/materials/tiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tilemapId: tm.id, group: name, color, cells }),
        })).json()
        tm = cat.tilemaps.find(x => x.id === tm.id)
        sel.clear()
        refresh()
      }
      return
    }
    if (tab === 'tiles' && tile) {
      const tm0 = cat.tilemaps.find(x => x.id === tile.tilemapId)
      const stride = tm0 ? tm0.tileSize + tm0.gap : 0
      const px = tile.c * stride
      const py = tile.r * stride
      insp.innerHTML = `
        <div>${tile.group}_${tile.n}</div>
        <label>tilemap</label>
        <div>${tile.tilemapId}</div>
        <label>cell</label>
        <div>c=${tile.c} r=${tile.r}</div>
        <label>pixels</label>
        <div>${px},${py} ${tm0 ? tm0.tileSize + '×' + tm0.tileSize : ''}</div>
        <label>description</label>
        <textarea id="mat-desc">${tile.description || ''}</textarea>
        <label>applies to</label>
        ${CATEGORIES.map(k => `<label class="chk"><input type="checkbox" data-cat="${k}" ${tile.categories.includes(k) ? 'checked' : ''}> ${k}</label>`).join('')}
      `
      const desc = insp.querySelector('#mat-desc') as HTMLTextAreaElement
      desc.onchange = async () => { tile.description = desc.value; await saveCat() }
      insp.querySelectorAll('input[data-cat]').forEach((box: HTMLInputElement) => {
        box.onchange = async () => {
          const k = box.dataset.cat as Category
          if (box.checked) { if (!tile.categories.includes(k)) tile.categories.push(k) }
          else tile.categories = tile.categories.filter(x => x !== k)
          await saveCat()
        }
      })
      return
    }
    insp.innerHTML = '<div class="muted">select a tilemap or tile</div>'
  }

  function draw() {
    const dpr = devicePixelRatio || 1
    const w = cv.clientWidth, h = cv.clientHeight
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, w, h)
    if (tab === 'tiles' && tile) {
      const img = new Image()
      img.onload = () => {
        const s = Math.min(12, Math.floor(Math.min(w, h) / img.naturalWidth))
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(img, 16, 16, img.naturalWidth * s, img.naturalHeight * s)
      }
      img.src = '/materials/tiles/' + tile.id
      return
    }
    if (!sheet || !tm || !sheet.complete) return
    ctx.drawImage(sheet, 0, 0, sheet.naturalWidth * zoom, sheet.naturalHeight * zoom)
    const g = grid()
    ctx.strokeStyle = '#ffffff44'
    ctx.lineWidth = 1
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
      ctx.strokeRect(c * g.stride * zoom, r * g.stride * zoom, tm.tileSize * zoom, tm.tileSize * zoom)
    }
    for (const group of tm.groups) {
      ctx.strokeStyle = group.color
      ctx.lineWidth = 2
      for (const cell of group.cells) {
        ctx.strokeRect(cell.c * g.stride * zoom, cell.r * g.stride * zoom, tm.tileSize * zoom, tm.tileSize * zoom)
      }
    }
    ctx.fillStyle = '#ffdd0066'
    const marked = new Set(sel)
    if (box) {
      const c0 = Math.min(box.c0, box.c1), c1 = Math.max(box.c0, box.c1)
      const r0 = Math.min(box.r0, box.r1), r1 = Math.max(box.r0, box.r1)
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) marked.add(cellKey(c, r))
    }
    for (const k of marked) {
      const [c, r] = k.split(',').map(Number)
      ctx.fillRect(c * g.stride * zoom, r * g.stride * zoom, tm.tileSize * zoom, tm.tileSize * zoom)
    }
    const n = insp.querySelector('#mat-selcount')
    if (n) n.textContent = marked.size + ' cells selected'
  }

  cv.onmousedown = e => {
    if (tab !== 'tilemaps' || !tm) return
    const cell = atCell(e.offsetX, e.offsetY)
    if (!cell) return
    box = { c0: cell.c, r0: cell.r, c1: cell.c, r1: cell.r }
    draw()
  }
  cv.onmousemove = e => {
    if (!box) return
    const cell = atCell(e.offsetX, e.offsetY)
    if (!cell) return
    box.c1 = cell.c; box.r1 = cell.r
    draw()
  }
  cv.onmouseup = () => {
    if (!box) return
    const c0 = Math.min(box.c0, box.c1), c1 = Math.max(box.c0, box.c1)
    const r0 = Math.min(box.r0, box.r1), r1 = Math.max(box.r0, box.r1)
    if (c0 === c1 && r0 === r1) {
      const hit = tm.groups.find(g => g.cells.some(x => x.c === c0 && x.r === r0))
      if (hit) {
        sel.clear()
        for (const cell of hit.cells) sel.add(cellKey(cell.c, cell.r))
        box = null
        draw()
        return
      }
    }
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const k = cellKey(c, r)
      if (sel.has(k)) sel.delete(k)
      else sel.add(k)
    }
    box = null
    draw()
  }
  cv.onmouseleave = () => { if (box) { box = null; draw() } }
  cv.onwheel = e => {
    e.preventDefault()
    zoom = Math.max(1, Math.min(8, zoom + (e.deltaY > 0 ? -1 : 1)))
    draw()
  }

  function layout() {
    const dpr = devicePixelRatio || 1
    cv.width = cv.clientWidth * dpr
    cv.height = cv.clientHeight * dpr
    draw()
  }

  return {
    async show() {
      wrap.style.top = (document.getElementById('editor-bar').offsetHeight) + 'px'
      wrap.classList.add('on')
      await load()
      layout()
      refresh()
    },
    hide() { wrap.classList.remove('on') },
    layout,
    get catalog() { return cat },
  }
}
