# Plato — Copilot Instructions

## Build

```bash
npm run build   # tsc -b (composite, references ../tsutils)
```

No test or lint commands exist. Webpack is present as a dev dependency but `tsc` is the primary build tool.

## Architecture

Plato is a static web app: a 3D polyhedra viewer with an interactive drawing layer.

### Two-canvas system
`index.html` stacks two canvases:
- `#mainCanvas` — Three.js WebGL scene (3D model)
- `#textureCanvas` — 2D drawing overlay (Canvas API), treated as a texture on the 3D model

`WebglRenderer` (`webgl_renderer.ts`) owns three rendering passes per frame, executed in order:
1. **`draw_model`** — the polyhedron with texture-mapped drawing canvas
2. **`draw_mirrors`** — optional cyan mirror-plane geometry overlay
3. **`draw_overlay`** — the drawing canvas as a flat fullscreen quad (fades out over time)

### Rendering pipeline
- `THREE.Camera` is identity — all projection/view/rotation is passed as uniforms (`projector`: mat4, `model_transformer`: mat3)
- `matrix_uniforms(alpha)` in `webgl_utils.ts` computes these from `gl-matrix` each frame
- Shaders live as raw GLSL strings in `glsl.ts` (four exports: `VS_SOURCE`, `FS_SOURCE`, `FS_SOURCE_MIRRORS`, `VS_SOURCE_OVERLAY`, `FS_SOURCE_OVERLAY`)
- All materials use `THREE.RawShaderMaterial` with `glslVersion: THREE.GLSL3`
- Geometry is created fresh each frame via `model_to_geometry()` and disposed after `render_pass()`

### Model format
JSON files in `static/models/`:
```
vertices: number[]        // XYZ triplets (flat array, no index buffer)
normals?: number[]        // per-vertex surface normals
texture?: number[]        // UV coordinates (2 per vertex)
colors?: number[]         // RGBA vertex colors (4 per vertex)
mirrors?: number[]        // mirror plane geometry vertices
mirror_normals?: number[] // mirror plane normals
```
Model list is fetched from `static/models/models.txt` (comma-separated names). Models are cached in `localStorage` by name; the full list is cached under key `'model_list'`.

### Drawing with mirror symmetry
Strokes are drawn on `#textureCanvas` via the Canvas 2D API. Each stroke is simultaneously mirrored: `mirror_coordinates` maps `[x, y]` → `[w - x, h - y]` (point reflection through canvas centre). Both `path` and `mirror_path` are Path2D objects maintained in `App`.

### Dirty-flag rendering
`App.is_dirty` gates redraws. Any model load, user input, resize, or animation tick sets it. `WebglRenderer.texture_dirty` separately gates `texture.needsUpdate`.

### Key classes/modules
| File | Responsibility |
|---|---|
| `app.ts` | Top-level controller: UI, input, drawing, model loading, animation loop |
| `webgl_renderer.ts` | Three.js wrapper; owns scene, materials, passes |
| `webgl_utils.ts` | `Model` type, `matrix_uniforms()`, `model_to_geometry()`, `create_canvas_texture()` |
| `glsl.ts` | Raw GLSL strings only |
| `geometry_data.ts` | Fullscreen quad vertex/UV arrays for overlay pass |
| `index.ts` | Entry: `localStorage.clear()` then `new App('stellated_dodecahedron').init()` |
| `gallery_app.ts` | Separate app for gallery view (uses raw WebGL2 directly, `@ts-nocheck`) |

## Conventions

- **Naming**: `snake_case` throughout (variables, functions, methods, file names). Only class names use PascalCase.
- **Model geometry is unindexed**: All vertex/normal/UV arrays are flat, repeated per triangle vertex — no index buffers.
- **Attribute names in shaders** are prefixed `a` (e.g. `aVertexPosition`, `aNormalDirection`, `aTextureCoord`, `aVertexColor`); varyings prefixed `v`; uniforms have no prefix.
- **`@oded/tsutils`** is a local monorepo sibling (`../tsutils`). Used for `parse_RGBA` (color parsing) and `floodfill` (canvas flood fill). Import paths: `@oded/tsutils/color` and `@oded/tsutils/canvas`.
- **`moduleResolution: Bundler`** in tsconfig — use extensionless imports.
- The project is part of a monorepo; `tsconfig.json` references `../tsutils` as a composite project.
