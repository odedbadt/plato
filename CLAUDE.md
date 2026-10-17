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

**`src/ts/app.ts`** — Main application controller. Handles model loading, UI events, drawing with mirror symmetry, color/pen selection, and canvas lifecycle. Uses Vue 3 (minimal — just the model selector dropdown). Every model is generated on the spot by `src/ts/symmetry/`; there is no fetch, no cache and no loading state. `drop_stale_model_cache()` clears what the old fetching version left in localStorage and can go once no browser still holds it.

**`src/ts/symmetry/`** — Generates every polyhedron at runtime, replacing the JSON files that used to ship. A TypeScript port of the Python/jupytext notebooks in `~/work/weekend/concepts/symmetry/`.
- `linalg.ts` — vec3 / row-major mat3 helpers.
- `geometry.ts` — the Coxeter kaleidoscope construction: `place_mirrors()` positions three mirror planes at angles pi/x, pi/y, pi/z; `mirror_matrices_to_group_transformations()` closes the Householder reflections into the full group; `transformations_to_mesh()` sweeps one fundamental triangle through it; `build_mirror_mesh()` makes the cyan mirror-plane discs.
- `models.ts` — per-model parameters (`MODEL_SPECS`), the picker's name list, and `generate_model()`. Reflection groups are enumerated once and cached per family. `generate_model_from_spec()` / `generate_edges_from_spec()` take the parameters directly, so a spec edited at runtime generates as well as a registered one.

- `wythoff.ts` — the other way to build a solid: a single seed point inside the fundamental triangle, whose orbit under the group is the vertex set. A corner gives a Platonic solid, an edge a truncation, the interior the omnitruncated one, so one draggable point covers the whole uniform family. Fanning each face from its centre and splitting where it crosses a mirror leaves six triangles per fundamental domain, so it is the same sweep the classic path uses with six triangles instead of one; three base segments likewise sweep to every edge. A `seed` on the spec selects this path.

The picker chooses a **symmetry group** — `SYMMETRY_FAMILIES`, labelled by `family_label()` as e.g. "Icosahedral (5,3,2)" — not a named mesh. Changing it swaps the group under whatever the shape controls currently say, so a stellation or a seed position carries from one symmetry to the next. `MODEL_SPECS` stays as the preset registry behind `generate_model(name)` (it holds the parameters recovered from the retired JSON) but its names are history, not a menu; the opening view is the `stellated_dodecahedron` preset.

The controls panel's **Shape** section rides on that: stellation, size, mirror size, dual and rhombic all vary the fundamental triangle only, never the group, so a drag regenerates the whole solid in ~0.2 ms and the sliders are live. `stellation` is the continuous form of `stellated` (1 = the plain solid, 2 = what `stellated: true` gives) and overrides it; `round: false` skips the rounding that only exists to match the retired JSON. Faces are flat across a reflected edge only at the special stellation values, so in between every edge is a real crease and the wireframe is correctly denser. The drawing survives a morph untouched — every fundamental triangle carries the same UVs whatever the geometry does.

The **Seed point** checkbox swaps the stellation/dual/rhombic knobs for the seed pad, which draws the fundamental triangle flat with its corners labelled by rotation order. Seed mode maps UVs through barycentric coordinates on that triangle rather than giving every facet the same UV triangle, so a drawing lands on the part of the texture each piece's place in the domain calls for. At a corner this reproduces the classic generator exactly, geometry and texture both. Buffer layouts do not depend on where the seed sits — degenerate seeds just collapse triangles to zero area — so the in-place upload holds and the pad drags at ~0.18 ms a step.

Output matches the JSON it replaced exactly — vertices, normals and UVs are byte-identical for the models that were already generated, and within the generator's own 3-decimal rounding for the four whose parameters were recovered by fitting the shipped meshes (`sellated_*`, `random_colored_st_*`; see `MODEL_SPECS`). The one deliberate difference is the mirror mesh: the original's sign-canonicalisation compared floats against exactly `0`, so near-zero components let a plane and its negation both through, drawing 2 of the icosahedral discs twice (17 blocks for 15 planes, 11 for 9, 7 for 6). The port compares against an epsilon and emits each plane once; pass `legacy_duplicate_planes` to restore the old behaviour.

**`src/ts/webgl_renderer.ts`** — Wraps Three.js. Three rendering passes:
1. `main_material` — 3D model with texture mapping
2. `mirror_material` — Reflection plane geometry (cyan overlay)
3. `overlay_material` — Drawing canvas as a fullscreen quad

**`src/ts/glsl.ts`** — Raw GLSL shader strings. Directional lighting via dot-product normal shading; texture sampling with alpha blending.

**`src/ts/webgl_utils.ts`** — Matrix math helpers (`gl-matrix`) and geometry conversion: `model_to_geometry()` converts a generated model → Three.js `BufferGeometry`, `matrix_uniforms()` computes projection/view/rotation matrices.

### Model Format

Every model is generated at runtime by `src/ts/symmetry/`; `static/models/` is gone and nothing is fetched.
```typescript
{
  vertices: number[],       // XYZ triplets
  normals?: number[],       // surface normals
  texture?: number[],       // UV coordinates
  colors?: number[],        // RGBA vertex colors — never rendered, see below
  mirrors?: number[],       // mirror plane geometry
  mirror_normals?: number[] // mirror plane normals
}
```

`colors` is vestigial: the shipped JSON carried it, `model_to_geometry()` still uploads it as `aVertexColor`, and no shader has ever declared that attribute. That is why the six "coloured" models were interchangeable with their generated equivalents — the colours were inert. Nothing produces `colors` now.

### Dependencies
- `three` — WebGL rendering abstraction
- `gl-matrix` — 3D matrix/vector math

These are the only two runtime dependencies in `package.json`. `src/ts/symmetry/` deliberately uses its own small vec3/mat3 helpers rather than `gl-matrix`, so the port stays a close line-by-line match to the Python it came from.

