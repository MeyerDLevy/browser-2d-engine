# Retro Urban Kit sprites

A one-time offline render pass converting a subset of Kenney's **Retro Urban Kit** 3D models
into flat isometric PNG sprites, following the same convention as the furniture sprites in this
folder (transparent background, 4 rotation variants per piece, trimmed to opaque bbox).

## Source

- Pack: [Retro Urban Kit](https://kenney.nl/assets/retro-urban-kit) by Kenney (kenney.nl)
- License: **CC0** (public domain) — free to use, credit appreciated but not required
- Downloaded as `kenney_retro-urban-kit.zip`, used the `Models/OBJ format/` folder (OBJ + MTL +
  a small shared set of texture atlases under `Models/OBJ format/Textures/`)

## Rendering approach

No Blender or three.js/WebGL was available/needed in the end. `node --version` showed Node
v26 but no Blender on PATH and no headless GPU/WebGL context available for three.js's
`WebGLRenderer`, so rather than fight `headless-gl` on Windows, this uses a small **from-scratch
software rasterizer** in plain TypeScript (`tools/retro-urban-kit-render/render.ts`, run with
`tsx`, only dependency is `pngjs` for PNG decode/encode — no native modules, no GPU):

1. Hand-parses the `.obj` (positions/uvs/triangle faces per material) and `.mtl`
   (material → texture PNG) — these kits use plain triangle-soup OBJs, no quads/ngons.
2. Projects vertices with the *exact* dimetric math this engine already uses for its 2:1 grid:
   `screenX = (x - z) * (TILE_W/2)`, `groundY = (x + z) * (TILE_H/2)`, `screenY = groundY - y * heightK`
   (same shape as `iso()` in `shared/world.ts` plus the height-subtracts-from-y convention used
   for wall/roof height in `client/render.ts`). The camera is a fixed 45° yaw + 30° pitch, chosen
   because `sin(30°) = 0.5` is exactly what makes the projected ground diamond come out at a
   true 2:1 width:height ratio — i.e. these sprites are natively authored at the engine's exact
   diamond ratio, unlike the externally-rendered Kenney *Furniture* Kit sprites, which needed the
   `OBJ_SQUASH` correction constant in `client/render.ts` to fix up a 0.702 source ratio. **These
   new sprites need no such squash correction (squash = 1.0)** if/when they get wired up.
3. Each of the 4 rotation variants (`_0.._3`, matching how `objImgs` in `client/render.ts` is
   indexed) is just the model yawed by an additional 0/90/180/270° before the same fixed camera
   projection.
4. Rasterizes every triangle with a real per-pixel **z-buffer** (not painter's-algorithm sorting),
   using a camera-space depth of `0.5*y + cos(45°)*cos(30°)*(x+z)` (larger = nearer camera) — this
   correctly resolves recessed geometry like the window/door cutouts in the wall panels without
   needing any special-cased face ordering.
5. Textures are sampled with wraparound (`u mod 1`, `v mod 1`) since these kits tile texture
   atlases across a piece's UVs.
6. The rendered canvas is trimmed to its opaque bounding box (+2px padding), matching how the
   furniture PNGs are trimmed.

## Re-running / adding more models

1. Download the zip from https://kenney.nl/assets/retro-urban-kit (the page's donate-or-skip
   dialog has a direct `.zip` link — inspect the page HTML for the `kenney_retro-urban-kit.zip`
   URL if the "Download" button doesn't work programmatically) or via
   https://kenney-assets.itch.io/retro-urban-kit.
2. Extract it to `tmp_retro_urban_kit/` at the repo root (so `tmp_retro_urban_kit/Models/OBJ format/`
   exists — this matches `KIT_DIR` in the script; adjust the constant if you extract elsewhere).
3. Add entries to the `MODELS` array in `tools/retro-urban-kit-render/render.ts` (each is just
   `{ file: '<name>.obj', id: '<camelCaseSpriteId>', desc: '...' }` — pick any `.obj` from
   `Models/OBJ format/`, ids must not collide with existing furniture ids).
4. Run `npx tsx tools/retro-urban-kit-render/render.ts`. It writes directly into this folder.
5. Sanity-check proportions with a copy of `tmp-retrocheck.ps1` (repo root) — it overlays each
   sprite over a stroked tile-footprint diamond using the `OBJ_FILL`/`OBJ_SQUASH`-style anchoring
   math from `drawObjectBox` in `client/render.ts`, at a guessed `OBJ_FILL` per id, and writes a
   composite PNG you can eyeball.
6. Delete the extracted `tmp_retro_urban_kit/` folder (and the zip) once you're happy — it's not
   needed at runtime, only during the render pass.

## Sprites produced (this pass)

| sprite id     | source model            | description |
|---------------|--------------------------|-------------|
| `wallPlain`   | `wall-a.obj`             | Plain concrete/brick wall panel (all 4 sides identical, so all rotations look the same) |
| `wallWindow`  | `wall-a-window.obj`      | Wall panel with a built-in barred window (window only visible from 2 of the 4 rotations, since it's on one face of the panel) |
| `wallDoorway` | `wall-a-door.obj`        | Wall panel with a doorway opening + door built in (same one-face-only caveat as above) |
| `doorPanel`   | `door-type-a.obj`        | Standalone door, for mounting into a generic wall opening |
| `windowPanel` | `window-wide-type-a.obj` | Standalone wide window, for mounting into a generic wall opening |
| `fencePanel`  | `wall-fence.obj`         | Low metal-barred fence panel with concrete posts |
| `roofSlant`   | `wall-a-roof-slant.obj`  | Sloped roof-edge panel (corrugated metal roof + brick gable end) |
| `stepsPanel`  | `wall-steps-type-a.obj`  | Stepped stairs panel, brick risers on a concrete base |

All are un-scaled 1×1-tile-footprint pieces (matching a single `wall-a`-style 1×1×1 unit cube in
Kenney's source scale). They are **not** wired into `OBJ_TYPES` / the editor yet — this pass only
produces the PNGs plus this note, per the current task scope.
