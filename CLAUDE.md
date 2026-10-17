# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# From this directory (plato/ is self-contained — it has its own package.json
# and node_modules; there is no package.json one level up):
npm run build   # TypeScript type-checking (tsc -b)
npm run bundle  # Webpack bundle — required for the app to pick up changes
```

`index.html` loads `./bundle.js`, which webpack writes to this directory. Running only `tsc -b` does **not** update the bundle.

## Architecture

**Plato** is an interactive 3D polyhedra viewer — a static web app where users can view, rotate, and draw on Platonic solids and related shapes.

### Entry Points
- `index.html` — Two stacked canvases: `#mainCanvas` (3D) and `#textureCanvas` (drawing overlay)
- `src/ts/index.ts` — Dynamically imports `app.ts`, initializes with `stellated_dodecahedron`

### Core Modules

**`src/ts/app.ts`** — Main application controller. Handles model loading, UI events, drawing with mirror symmetry, color/pen selection, and canvas lifecycle. Uses Vue 3 (minimal — just the model selector dropdown). `load_model_by_name()` is the loading seam: generated models are built on the spot, and only the legacy coloured models are fetched and cached in localStorage.

**`src/ts/symmetry/`** — Generates the polyhedra at runtime, replacing most of the JSON files that used to ship. A TypeScript port of the Python/jupytext notebooks in `~/work/weekend/concepts/symmetry/`.
- `linalg.ts` — vec3 / row-major mat3 helpers.
- `geometry.ts` — the Coxeter kaleidoscope construction: `place_mirrors()` positions three mirror planes at angles pi/x, pi/y, pi/z; `mirror_matrices_to_group_transformations()` closes the Householder reflections into the full group; `transformations_to_mesh()` sweeps one fundamental triangle through it; `build_mirror_mesh()` makes the cyan mirror-plane discs.
- `models.ts` — per-model parameters (`MODEL_SPECS`), the picker's name list, and `generate_model()`. Reflection groups are enumerated once and cached per family.

Output matches the JSON it replaced exactly — vertices, normals and UVs are byte-identical. The one deliberate difference is the mirror mesh: the original's sign-canonicalisation compared floats against exactly `0`, so near-zero components let a plane and its negation both through, drawing 2 of the icosahedral discs twice (17 blocks for 15 planes, 11 for 9, 7 for 6). The port compares against an epsilon and emits each plane once; pass `legacy_duplicate_planes` to restore the old behaviour.

**`src/ts/webgl_renderer.ts`** — Wraps Three.js. Three rendering passes:
1. `main_material` — 3D model with texture mapping
2. `mirror_material` — Reflection plane geometry (cyan overlay)
3. `overlay_material` — Drawing canvas as a fullscreen quad

**`src/ts/glsl.ts`** — Raw GLSL shader strings. Directional lighting via dot-product normal shading; texture sampling with alpha blending.

**`src/ts/webgl_utils.ts`** — Matrix math helpers (`gl-matrix`) and geometry conversion: `model_to_geometry()` converts model JSON → Three.js `BufferGeometry`, `matrix_uniforms()` computes projection/view/rotation matrices.

### Model Format

Most models are generated at runtime by `src/ts/symmetry/`. Six legacy randomly-coloured variants (`dodecahedron`, `icosahedron`, `sellated_*`, `random_colored_st_*`) are not reproducible from the generator and still load from `static/models/*.json`. Both paths produce the same shape:
```typescript
{
  vertices: number[],       // XYZ triplets
  normals?: number[],       // surface normals
  texture?: number[],       // UV coordinates
  colors?: number[],        // RGBA vertex colors
  mirrors?: number[],       // mirror plane geometry
  mirror_normals?: number[] // mirror plane normals
}
```

### Dependencies
- `three` — WebGL rendering abstraction
- `gl-matrix` — 3D matrix/vector math

These are the only two runtime dependencies in `package.json`. `src/ts/symmetry/` deliberately uses its own small vec3/mat3 helpers rather than `gl-matrix`, so the port stays a close line-by-line match to the Python it came from.

